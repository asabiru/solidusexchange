<?php

namespace App\Services\ExchangePipeline;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * AMLBot KYT (Know-Your-Transaction) wallet screening service.
 *
 * Docs: https://docs.amlbot.com/webApi/introduction
 *
 * Set AMLBOT_API_KEY in .env to enable live screening.
 */
class AmlBotService
{
    private const BASE_URL = 'https://amlbot.com/api/v1';

    private string $apiKey;
    private bool $enabled;

    public function __construct()
    {
        $this->apiKey  = (string) config('exchange_pipeline.aml.api_key', '');
        $this->enabled = $this->apiKey !== '';
    }

    public function isReady(): bool
    {
        return $this->enabled;
    }

    /**
     * Screen a single wallet address.
     *
     * Returns an array with keys:
     *   - result:     'clean' | 'flagged' | 'blocked' | 'error'
     *   - risk_score: float 0–100 (null if unavailable)
     *   - risk_level: 'low' | 'medium' | 'high' | 'unknown'
     *   - notes:      string
     */
    public function screenAddress(string $address, string $currencyCode): array
    {
        if (!$this->enabled) {
            return [
                'result'     => 'error',
                'risk_score' => null,
                'risk_level' => 'unknown',
                'notes'      => 'AMLBot API key is not configured.',
            ];
        }

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Token ' . $this->apiKey,
                'Content-Type'  => 'application/json',
            ])->timeout(15)->post(self::BASE_URL . '/check_wallet/', [
                'address'  => $address,
                'currency' => strtoupper($currencyCode),
            ]);

            if ($response->failed()) {
                Log::warning('AMLBot screenAddress HTTP error', [
                    'address'  => $address,
                    'currency' => $currencyCode,
                    'status'   => $response->status(),
                    'body'     => $response->body(),
                ]);

                return [
                    'result'     => 'error',
                    'risk_score' => null,
                    'risk_level' => 'unknown',
                    'notes'      => 'AMLBot API returned HTTP ' . $response->status() . '. Manual review required.',
                ];
            }

            $data = $response->json();

            return $this->parseScreeningResponse($data, $address, $currencyCode);

        } catch (\Throwable $e) {
            Log::error('AMLBot screenAddress exception', [
                'address'  => $address,
                'currency' => $currencyCode,
                'error'    => $e->getMessage(),
            ]);

            return [
                'result'     => 'error',
                'risk_score' => null,
                'risk_level' => 'unknown',
                'notes'      => 'AMLBot API call failed: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Parse AMLBot /check_wallet/ response.
     */
    private function parseScreeningResponse(mixed $data, string $address, string $currency): array
    {
        if (!is_array($data)) {
            return [
                'result'     => 'error',
                'risk_score' => null,
                'risk_level' => 'unknown',
                'notes'      => 'AMLBot returned unexpected response format.',
            ];
        }

        // AMLBot returns risk_score as 0–100 float
        $riskScore = isset($data['risk_score']) ? (float) $data['risk_score'] : null;

        // AMLBot may return risk as 'low'/'medium'/'high'/'critical'
        $riskLabel = strtolower((string) ($data['risk'] ?? $data['risk_level'] ?? ''));

        $riskLevel = match ($riskLabel) {
            'low'              => 'low',
            'medium', 'moderate' => 'medium',
            'high', 'critical' => 'high',
            default            => ($riskScore !== null ? $this->scoreToLevel($riskScore) : 'unknown'),
        };

        // Blocked if risk is high/critical or explicitly flagged
        $isBlocked  = in_array($riskLabel, ['high', 'critical'], true) || ($riskScore !== null && $riskScore >= 75);
        $isFlagged  = in_array($riskLabel, ['medium', 'moderate'], true) || ($riskScore !== null && $riskScore >= 40 && $riskScore < 75);

        $result = match (true) {
            $isBlocked => 'blocked',
            $isFlagged => 'flagged',
            default    => 'clean',
        };

        $categoryNames = [];
        if (!empty($data['signals']) && is_array($data['signals'])) {
            $categoryNames = array_column($data['signals'], 'name');
        } elseif (!empty($data['categories']) && is_array($data['categories'])) {
            $categoryNames = $data['categories'];
        }

        $notes = 'AMLBot screening completed.';
        if ($riskScore !== null) {
            $notes .= ' Risk score: ' . round($riskScore, 1) . '/100.';
        }
        if (!empty($categoryNames)) {
            $notes .= ' Categories: ' . implode(', ', $categoryNames) . '.';
        }

        return [
            'result'     => $result,
            'risk_score' => $riskScore,
            'risk_level' => $riskLevel,
            'notes'      => $notes,
            '_raw'       => $data,
        ];
    }

    private function scoreToLevel(float $score): string
    {
        if ($score >= 75) {
            return 'high';
        }
        if ($score >= 40) {
            return 'medium';
        }
        return 'low';
    }
}
