<?php

namespace App\Services\Kyc;

use App\Models\Kyc;
use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use RuntimeException;

class SumsubKycService
{
    public function __construct(private readonly SumsubClient $client)
    {
    }

    public function startSession(User $user, Kyc $kyc): array
    {
        if (($kyc->provider ?? 'manual') !== 'sumsub') {
            throw new RuntimeException('This KYC form does not use Sumsub.');
        }

        if (!(int) (basicControl()->sumsub_enabled ?? 0)) {
            throw new RuntimeException('Enable Sumsub in KYC provider settings before starting verification.');
        }

        $levelName = $this->resolveLevelName($kyc);
        if ($levelName === '') {
            throw new RuntimeException('Set Sumsub level name in KYC settings or global KYC provider settings.');
        }

        $userKyc = UserKyc::query()
            ->where('user_id', $user->id)
            ->where('kyc_id', $kyc->id)
            ->where('provider', 'sumsub')
            ->latest()
            ->first();

        $externalUserId = $this->externalUserId($user->id, $kyc->id);
        $applicantId = $userKyc?->provider_applicant_id;

        if (!$applicantId) {
            $applicant = $this->client->createApplicant([
                'externalUserId' => $externalUserId,
                'email' => $user->email,
                'type' => 'individual',
                'lang' => app()->getLocale(),
                'fixedInfo' => array_filter([
                    'firstName' => $user->firstname,
                    'lastName' => $user->lastname,
                ]),
            ], $levelName);

            $applicantId = (string) ($applicant['id'] ?? '');
            if ($applicantId === '') {
                throw new RuntimeException('Sumsub did not return applicant id.');
            }
        }

        $tokenData = $this->client->generateSdkToken($externalUserId, $levelName, 3600);
        $token = (string) ($tokenData['token'] ?? $tokenData['accessToken'] ?? '');
        if ($token === '') {
            throw new RuntimeException('Sumsub did not return SDK access token.');
        }

        $userKyc = UserKyc::updateOrCreate(
            [
                'user_id' => $user->id,
                'kyc_id' => $kyc->id,
                'provider' => 'sumsub',
            ],
            [
                'kyc_type' => $kyc->name,
                'status' => 0,
                'reason' => null,
                'kyc_info' => $userKyc?->kyc_info ?? [],
                'provider_applicant_id' => $applicantId,
                'provider_review_status' => 'pending',
                'provider_review_answer' => null,
                'provider_completed_at' => null,
                'provider_payload' => array_merge($userKyc?->provider_payload ?? [], [
                    'level_name' => $levelName,
                    'external_user_id' => $externalUserId,
                ]),
            ]
        );

        return [
            'token' => $token,
            'applicant_id' => $applicantId,
            'level_name' => $levelName,
            'websdk_url' => (string) (basicControl()->sumsub_websdk_url ?: 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js'),
            'user_kyc_id' => $userKyc->id,
        ];
    }

    public function handleWebhook(Request $request): array
    {
        if (!$this->client->verifyWebhook($request)) {
            throw new RuntimeException('Invalid Sumsub webhook signature.');
        }

        $payload = $request->json()->all();
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid Sumsub webhook payload.');
        }

        $applicantId = (string) Arr::get($payload, 'applicantId', '');
        $externalUserId = (string) Arr::get($payload, 'externalUserId', '');
        $reviewStatus = (string) Arr::get($payload, 'reviewStatus', '');
        $reviewAnswer = (string) Arr::get($payload, 'reviewResult.reviewAnswer', '');

        $userKyc = $this->findUserKyc($applicantId, $externalUserId);
        if (!$userKyc) {
            return ['status' => 'ignored'];
        }

        $userKyc->provider_review_status = $reviewStatus;
        $userKyc->provider_review_answer = $reviewAnswer;
        $userKyc->provider_payload = $payload;

        if ($reviewStatus === 'completed' && strtoupper($reviewAnswer) === 'GREEN') {
            $userKyc->status = 1;
            $userKyc->provider_completed_at = now();
            $userKyc->reason = null;
            optional($userKyc->user)->forceFill(['identity_verify' => 2])->save();
        } elseif ($reviewStatus === 'completed' && strtoupper($reviewAnswer) === 'RED') {
            $userKyc->status = 2;
            $userKyc->provider_completed_at = now();
            $userKyc->reason = $this->extractRejectReason($payload);
            optional($userKyc->user)->forceFill(['identity_verify' => 3])->save();
        } else {
            $userKyc->status = 0;
        }

        $userKyc->save();

        return ['status' => 'ok'];
    }

    public function resolveLevelName(Kyc $kyc): string
    {
        return trim((string) ($kyc->provider_settings['level_name'] ?? basicControl()->sumsub_level_name ?? ''));
    }

    private function findUserKyc(string $applicantId, string $externalUserId): ?UserKyc
    {
        $query = UserKyc::query()->where('provider', 'sumsub');

        if ($applicantId !== '') {
            $record = (clone $query)->where('provider_applicant_id', $applicantId)->latest()->first();
            if ($record) {
                return $record;
            }
        }

        if ($externalUserId !== '') {
            [$userId, $kycId] = $this->parseExternalUserId($externalUserId);
            if ($userId && $kycId) {
                return (clone $query)
                    ->where('user_id', $userId)
                    ->where('kyc_id', $kycId)
                    ->latest()
                    ->first();
            }
        }

        return null;
    }

    private function extractRejectReason(array $payload): string
    {
        $comment = trim((string) Arr::get($payload, 'reviewResult.moderationComment', ''));
        if ($comment !== '') {
            return $comment;
        }

        $labels = Arr::get($payload, 'reviewResult.rejectLabels', []);
        if (is_array($labels) && count($labels) > 0) {
            return implode(', ', array_map(static fn($value) => (string) $value, $labels));
        }

        return 'Sumsub verification was rejected.';
    }

    private function externalUserId(int $userId, int $kycId): string
    {
        return "user:{$userId}:kyc:{$kycId}";
    }

    private function parseExternalUserId(string $externalUserId): array
    {
        if (!preg_match('/^user:(\d+):kyc:(\d+)$/', $externalUserId, $matches)) {
            return [null, null];
        }

        return [(int) $matches[1], (int) $matches[2]];
    }
}
