<?php

namespace App\Services\Kyc;

use App\Models\Kyc;
use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use RuntimeException;

class DiditKycService
{
    public function __construct(
        private readonly DiditClient $client,
        private readonly UserKycManager $userKycManager,
    ) {
    }

    public function startSession(User $user, Kyc $kyc, ?string $callback = null): array
    {
        if (($kyc->provider ?? 'manual') !== 'didit') {
            throw new RuntimeException('This KYC form does not use Didit.');
        }

        if (!(int) (basicControl()->didit_enabled ?? 0)) {
            throw new RuntimeException('Enable Didit in KYC provider settings before starting verification.');
        }

        $workflowId = $this->resolveWorkflowId($kyc);
        if ($workflowId === '') {
            throw new RuntimeException('Set Didit workflow ID in KYC settings or global KYC provider settings.');
        }

        $externalUserId = $this->externalUserId($user->id, $kyc->id);
        $userKyc = UserKyc::query()
            ->where('user_id', $user->id)
            ->where('kyc_id', $kyc->id)
            ->where('provider', 'didit')
            ->latest()
            ->first();

        $sessionId = (string) ($userKyc?->provider_applicant_id ?? '');
        $sessionUrl = (string) Arr::get($userKyc?->provider_payload ?? [], 'session_url', '');

        if ($sessionId === '' || $this->isTerminalStatus((string) $userKyc?->provider_review_status)) {
            $session = $this->client->createSession($this->sessionPayload($user, $workflowId, $externalUserId, $callback));
            $sessionId = (string) ($session['session_id'] ?? '');
            $sessionUrl = (string) ($session['url'] ?? $session['session_url'] ?? '');

            if ($sessionId === '' || $sessionUrl === '') {
                throw new RuntimeException('Didit did not return a verification session URL.');
            }
        }

        $userKyc = UserKyc::updateOrCreate(
            [
                'user_id' => $user->id,
                'kyc_id' => $kyc->id,
                'provider' => 'didit',
            ],
            [
                'kyc_type' => $kyc->name,
                'status' => 0,
                'reason' => null,
                'kyc_info' => $userKyc?->kyc_info ?? [],
                'provider_applicant_id' => $sessionId,
                'provider_review_status' => $userKyc?->provider_review_status ?: 'Not Started',
                'provider_review_answer' => null,
                'provider_completed_at' => null,
                'provider_payload' => array_merge($userKyc?->provider_payload ?? [], [
                    'workflow_id' => $workflowId,
                    'external_user_id' => $externalUserId,
                    'session_url' => $sessionUrl,
                ]),
            ]
        );

        if ((int) $user->identity_verify !== 2) {
            $this->userKycManager->refreshUserVerificationStatus($user->fresh());
        }

        return [
            'session_id' => $sessionId,
            'url' => $sessionUrl,
            'user_kyc_id' => $userKyc->id,
        ];
    }

    public function handleWebhook(Request $request): array
    {
        if (!$this->client->verifyWebhook($request)) {
            throw new RuntimeException('Invalid Didit webhook signature.');
        }

        $payload = $request->json()->all();
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid Didit webhook payload.');
        }

        $sessionId = (string) Arr::get($payload, 'session_id', '');
        $vendorData = (string) Arr::get($payload, 'vendor_data', '');
        $status = (string) Arr::get($payload, 'status', '');

        $userKyc = $this->findUserKyc($sessionId, $vendorData);
        if (!$userKyc) {
            return ['status' => 'ignored'];
        }

        $decision = Arr::get($payload, 'decision');
        if (!is_array($decision) && $sessionId !== '') {
            try {
                $decision = $this->client->getDecision($sessionId);
            } catch (\Throwable $exception) {
                report($exception);
                $decision = null;
            }
        }

        $userKyc->provider_review_status = $status;
        $userKyc->provider_review_answer = $this->decisionAnswer($status);

        $providerPayload = is_array($userKyc->provider_payload) ? $userKyc->provider_payload : [];
        $providerPayload['webhook'] = $payload;
        if (is_array($decision)) {
            $providerPayload['decision'] = $decision;
            $diditKycInfo = $this->userKycManager->buildKycInfoFromDiditDecision($decision);
            if ($diditKycInfo !== []) {
                $userKyc->kyc_info = $diditKycInfo;
            }
        }
        $userKyc->provider_payload = $providerPayload;

        $this->applyStatus($userKyc, $status, $payload, is_array($decision) ? $decision : []);
        $userKyc->save();

        if ($userKyc->user) {
            $this->userKycManager->refreshUserVerificationStatus($userKyc->user->fresh());

            if ((int) $userKyc->status === 1) {
                $this->userKycManager->syncApprovedKycToProfile($userKyc->fresh('user'));
            }
        }

        return ['status' => 'ok'];
    }

    public function resolveWorkflowId(Kyc $kyc): string
    {
        return trim((string) ($kyc->provider_settings['workflow_id'] ?? basicControl()->didit_workflow_id ?? env('DIDIT_WORKFLOW_ID', '')));
    }

    private function sessionPayload(User $user, string $workflowId, string $externalUserId, ?string $callback): array
    {
        $payload = [
            'workflow_id' => $workflowId,
            'callback' => $callback ?: route('user.verification.center'),
            'callback_method' => 'both',
            'vendor_data' => $externalUserId,
            'metadata' => [
                'user_id' => $user->id,
                'provider' => 'solidchange',
            ],
            'language' => 'ru',
        ];

        if (filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
            $payload['contact_details'] = [
                'email' => $user->email,
                'email_lang' => 'ru',
                'send_notification_emails' => false,
            ];
        }

        return $payload;
    }

    private function applyStatus(UserKyc $userKyc, string $status, array $payload, array $decision): void
    {
        $normalized = mb_strtolower($status);
        if ($normalized === 'approved') {
            $userKyc->status = 1;
            $userKyc->provider_completed_at = now();
            $userKyc->reason = null;
            return;
        }

        if (in_array($normalized, ['declined', 'expired', 'kyc expired', 'abandoned'], true)) {
            $userKyc->status = 2;
            $userKyc->provider_completed_at = now();
            $userKyc->reason = $this->extractRejectReason($payload, $decision);
            return;
        }

        $userKyc->status = 0;
    }

    private function findUserKyc(string $sessionId, string $vendorData): ?UserKyc
    {
        $query = UserKyc::query()->where('provider', 'didit');

        if ($sessionId !== '') {
            $record = (clone $query)->where('provider_applicant_id', $sessionId)->latest()->first();
            if ($record) {
                return $record;
            }
        }

        if ($vendorData !== '') {
            [$userId, $kycId] = $this->parseExternalUserId($vendorData);
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

    private function decisionAnswer(string $status): string
    {
        return match (mb_strtolower($status)) {
            'approved' => 'GREEN',
            'declined' => 'RED',
            default => 'PENDING',
        };
    }

    private function extractRejectReason(array $payload, array $decision): string
    {
        $reviews = Arr::get($decision, 'reviews', []);
        if (is_array($reviews)) {
            foreach ($reviews as $review) {
                $comment = trim((string) Arr::get((array) $review, 'comment', ''));
                if ($comment !== '') {
                    return $comment;
                }
            }
        }

        return trim((string) Arr::get($payload, 'status', '')) ?: 'Didit verification was not approved.';
    }

    private function isTerminalStatus(string $status): bool
    {
        return in_array(mb_strtolower($status), ['approved', 'declined', 'expired', 'kyc expired', 'abandoned'], true);
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
