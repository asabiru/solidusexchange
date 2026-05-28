<?php

namespace App\Services\Kyc;

use App\Models\Kyc;
use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * AMLBot KYC service.
 *
 * Provides iFrame-based identity verification via AMLBot KYC.
 * KYC app URL: https://kyc-app.amlbot.com/
 * Docs: https://docs.amlbot.com
 *
 * Set AMLBOT_API_KEY in .env to enable.
 */
class AmlBotKycService
{
    private const KYC_APP_BASE = 'https://kyc-app.amlbot.com';
    private const API_BASE     = 'https://amlbot.com/api/v1';

    private string $apiKey;

    public function __construct(
        private readonly UserKycManager $userKycManager,
    ) {
        $this->apiKey = (string) config('exchange_pipeline.aml.api_key', '');
    }

    public function isReady(): bool
    {
        return $this->apiKey !== '';
    }

    /**
     * Start or resume an AMLBot KYC session for a user.
     *
     * Returns session data including iFrame URL to embed.
     */
    public function startSession(User $user, Kyc $kyc): array
    {
        if (($kyc->provider ?? 'manual') !== 'amlbot') {
            throw new RuntimeException('This KYC form does not use AMLBot.');
        }

        if (!$this->isReady()) {
            throw new RuntimeException('AMLBot API key is not configured. Set AMLBOT_API_KEY in .env.');
        }

        $externalUserId = $this->externalUserId($user->id, $kyc->id);

        // Create or retrieve applicant token from AMLBot
        $tokenData = $this->createOrGetApplicantToken($externalUserId, $user);

        $iframeToken = (string) ($tokenData['token'] ?? '');
        if ($iframeToken === '') {
            throw new RuntimeException('AMLBot did not return a session token.');
        }

        $userKyc = UserKyc::updateOrCreate(
            [
                'user_id'  => $user->id,
                'kyc_id'   => $kyc->id,
                'provider' => 'amlbot',
            ],
            [
                'kyc_type'              => $kyc->name,
                'status'                => 0,
                'reason'                => null,
                'provider_review_status' => 'pending',
                'provider_review_answer' => null,
                'provider_completed_at' => null,
                'provider_payload'      => [
                    'external_user_id' => $externalUserId,
                    'token'            => $iframeToken,
                ],
            ]
        );

        if ((int) $user->identity_verify !== 2) {
            $this->userKycManager->refreshUserVerificationStatus($user->fresh());
        }

        $iframeUrl = self::KYC_APP_BASE . '?token=' . urlencode($iframeToken);

        return [
            'token'       => $iframeToken,
            'iframe_url'  => $iframeUrl,
            'user_kyc_id' => $userKyc->id,
        ];
    }

    /**
     * Handle AMLBot KYC webhook callback.
     */
    public function handleWebhook(Request $request): array
    {
        $payload = $request->json()->all();
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid AMLBot webhook payload.');
        }

        $externalUserId = (string) ($payload['external_user_id'] ?? '');
        $status         = (string) ($payload['status'] ?? '');

        if ($externalUserId === '') {
            Log::warning('AMLBot webhook: missing external_user_id', $payload);
            return ['status' => 'ignored'];
        }

        [$userId, $kycId] = $this->parseExternalUserId($externalUserId);
        if (!$userId || !$kycId) {
            Log::warning('AMLBot webhook: cannot parse external_user_id', ['external_user_id' => $externalUserId]);
            return ['status' => 'ignored'];
        }

        $userKyc = UserKyc::where('user_id', $userId)
            ->where('kyc_id', $kycId)
            ->where('provider', 'amlbot')
            ->latest()
            ->first();

        if (!$userKyc) {
            return ['status' => 'ignored'];
        }

        $userKyc->provider_review_status = $status;
        $providerPayload                 = is_array($userKyc->provider_payload) ? $userKyc->provider_payload : [];
        $providerPayload['webhook']      = $payload;
        $userKyc->provider_payload       = $providerPayload;

        // AMLBot statuses: 'approved' | 'rejected' | 'pending' | 'retry'
        match (strtolower($status)) {
            'approved' => static function () use ($userKyc) {
                $userKyc->status               = 1;
                $userKyc->provider_review_answer = 'GREEN';
                $userKyc->provider_completed_at = now();
                $userKyc->reason               = null;
            },
            'rejected' => static function () use ($userKyc, $payload) {
                $userKyc->status               = 2;
                $userKyc->provider_review_answer = 'RED';
                $userKyc->provider_completed_at = now();
                $userKyc->reason               = (string) ($payload['rejection_reason'] ?? 'AMLBot verification was rejected.');
            },
            default => static function () use ($userKyc) {
                $userKyc->status = 0;
            },
        }();

        $userKyc->save();

        if ($userKyc->user) {
            $this->userKycManager->refreshUserVerificationStatus($userKyc->user->fresh());

            if ((int) $userKyc->status === 1) {
                $this->userKycManager->syncApprovedKycToProfile($userKyc->fresh('user'));
            }
        }

        return ['status' => 'ok'];
    }

    private function createOrGetApplicantToken(string $externalUserId, User $user): array
    {
        $response = Http::withHeaders([
            'Authorization' => 'Token ' . $this->apiKey,
            'Content-Type'  => 'application/json',
        ])->timeout(15)->post(self::API_BASE . '/kyc/token/', [
            'external_user_id' => $externalUserId,
            'email'            => $user->email,
        ]);

        if ($response->failed()) {
            throw new RuntimeException(
                'AMLBot KYC API error ' . $response->status() . ': ' . $response->body()
            );
        }

        return (array) $response->json();
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
