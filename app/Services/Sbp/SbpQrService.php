<?php

namespace App\Services\Sbp;

use App\Models\SbpPayment;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * SBP QR Payment Service via Tinkoff Business API.
 *
 * Flow:
 * 1. Create SBP payment → get QR code URL + payment_id
 * 2. User scans QR with bank app → pays
 * 3. Tinkoff sends webhook → we confirm payment
 * 4. Or we poll payment status periodically
 *
 * Fallback: manual mode — admin generates static QR and confirms manually.
 *
 * Tinkoff API docs: https://www.tinkoff.ru/business/help/payments/sbp/
 */
class SbpQrService
{
    private string $apiKey;
    private string $baseUrl;
    private string $inn;

    public function __construct()
    {
        // Read config with env() fallback — env() only works without config:cache
        // For production with config:cache, values are baked into config at cache time
        $this->apiKey = config('services.tinkoff.api_key', '') ?: env('TINKOFF_API_KEY', '');
        $this->baseUrl = config('services.tinkoff.base_url', 'https://securepay.tinkoff.ru/v2') ?: env('TINKOFF_BASE_URL', 'https://securepay.tinkoff.ru/v2');
        $this->inn = config('services.tinkoff.inn', '') ?: env('TINKOFF_INN', '');
    }

    /**
     * Get an env/config value that works even with config:cache.
     * Tries config first, then reads .env file directly.
     */
    private function getEnvConfig(string $configKey, string $envKey, string $default = ''): string
    {
        $configVal = config($configKey);
        if (!empty($configVal) && $configVal !== $default) {
            return $configVal;
        }

        // Try env() (works without config:cache)
        $envVal = env($envKey);
        if (!empty($envVal)) {
            return $envVal;
        }

        // Last resort: read .env file directly
        static $envCache = null;
        if ($envCache === null) {
            $envPath = base_path('.env');
            if (file_exists($envPath)) {
                $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                $envCache = [];
                foreach ($lines as $line) {
                    if (str_starts_with(trim($line), '#')) continue;
                    if (str_contains($line, '=')) {
                        [$key, $value] = explode('=', $line, 2);
                        $envCache[trim($key)] = trim($value);
                    }
                }
            }
        }

        return $envCache[$envKey] ?? $default;
    }

    /**
     * Check if Tinkoff API is configured.
     */
    public function isConfigured(): bool
    {
        return !empty($this->apiKey) && !empty($this->inn);
    }

    /**
     * Create an SBP QR payment.
     * Returns ['payment_id' => string, 'qr_url' => string, 'qr_static' => string]
     */
    public function createPayment(float $amount, string $description = '', ?string $orderId = null): array
    {
        if (!$this->isConfigured()) {
            return $this->createStaticQr($amount, $description);
        }

        $orderId = $orderId ?? uniqid('SBP');

        try {
            $response = Http::timeout(15)->withHeaders([
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Content-Type' => 'application/json',
            ])->post("{$this->baseUrl}/Init", [
                'TerminalKey' => config('services.tinkoff.terminal_key', ''),
                'Amount'      => (int)round($amount * 100), // kopecks
                'OrderId'     => $orderId,
                'Description' => $description ?: "Оплата по QR SBP #{$orderId}",
                'PayType'     => 'O', // SBP (QR)
                'DATA'        => [
                    'PaymentType' => 'QR',
                ],
            ]);

            if (!$response->successful()) {
                Log::error('SBP: Tinkoff Init failed', ['status' => $response->status(), 'body' => $response->body()]);
                return $this->createStaticQr($amount, $description);
            }

            $data = $response->json();

            if (($data['Success'] ?? false) === false) {
                Log::error('SBP: Tinkoff Init error', ['error_code' => $data['ErrorCode'] ?? '', 'message' => $data['Message'] ?? '']);
                return $this->createStaticQr($amount, $description);
            }

            $paymentId = $data['PaymentId'] ?? null;

            // Now get the QR code
            $qrResponse = Http::timeout(15)->withHeaders([
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Content-Type' => 'application/json',
            ])->post("{$this->baseUrl}/GetQr", [
                'TerminalKey' => config('services.tinkoff.terminal_key', ''),
                'PaymentId'   => $paymentId,
                'PaymentType' => 'QR',
            ]);

            $qrData = $qrResponse->json();
            $qrUrl = $qrData['Data'] ?? null; // Base64-encoded QR image or URL
            $qrPayload = $qrData['PaymentUrl'] ?? null; // nspk://... payload for QR

            return [
                'payment_id'   => $paymentId,
                'order_id'     => $orderId,
                'qr_url'       => $qrUrl,
                'qr_payload'   => $qrPayload,
                'amount'       => $amount,
                'status'       => 'pending',
                'provider'     => 'tinkoff',
            ];

        } catch (\Throwable $e) {
            Log::error('SBP: Tinkoff API exception: ' . $e->getMessage());
            return $this->createStaticQr($amount, $description);
        }
    }

    /**
     * Create a static SBP QR code (fallback when no API configured).
     * Uses the NSPK QR standard: https://qr.nspk.ru/...
     */
    public function createStaticQr(float $amount, string $description = ''): array
    {
        $bankId = $this->getEnvConfig('services.sbp.bank_id', 'SBP_BANK_ID', '');
        $accountNumber = $this->getEnvConfig('services.sbp.account_number', 'SBP_ACCOUNT_NUMBER', '');
        $recipientName = $this->getEnvConfig('services.sbp.recipient_name', 'SBP_RECIPIENT_NAME', '');
        $inn = $this->getEnvConfig('services.sbp.inn', 'SBP_INN', $this->inn);

        if (empty($accountNumber)) {
            throw new RuntimeException('SBP account not configured. Set SBP_ACCOUNT_NUMBER in .env');
        }

        // Build NSPK QR payload
        // Format: https://qr.nspk.ru/...?bankName=...&account=...&amount=...&name=...
        $payload = $this->buildNspkPayload($bankId, $accountNumber, $recipientName, $inn, $amount, $description);

        // Generate QR code URL via NSPK API
        $qrUrl = $this->generateNspkQrUrl($payload);

        return [
            'payment_id'   => null,
            'order_id'     => null,
            'qr_url'       => $qrUrl,
            'qr_payload'   => $payload,
            'amount'       => $amount,
            'status'       => 'pending',
            'provider'     => 'static_qr',
        ];
    }

    /**
     * Check payment status via Tinkoff API.
     */
    public function checkPaymentStatus(string $paymentId): array
    {
        if (!$this->isConfigured()) {
            return ['status' => 'unknown', 'message' => 'API не настроен'];
        }

        try {
            $response = Http::timeout(15)->withHeaders([
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Content-Type' => 'application/json',
            ])->post("{$this->baseUrl}/GetState", [
                'TerminalKey' => config('services.tinkoff.terminal_key', ''),
                'PaymentId'   => $paymentId,
            ]);

            if (!$response->successful()) {
                return ['status' => 'error', 'message' => 'Запрос API не удался'];
            }

            $data = $response->json();
            $status = match ($data['Status'] ?? '') {
                'AUTHORIZED' => 'paid',       // Money reserved, waiting for confirmation
                'CONFIRMED'  => 'confirmed',  // Payment confirmed
                'REJECTED'   => 'rejected',   // Payment rejected
                'REFUNDED'   => 'refunded',   // Payment refunded
                default      => 'pending',     // NEW or other
            };

            return [
                'status'       => $status,
                'payment_id'   => $paymentId,
                'amount'       => ($data['Amount'] ?? 0) / 100,
                'message'      => $data['Message'] ?? '',
                'raw_status'   => $data['Status'] ?? '',
            ];

        } catch (\Throwable $e) {
            Log::error('SBP: Status check failed: ' . $e->getMessage());
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    /**
     * Confirm a payment (capture authorized funds).
     */
    public function confirmPayment(string $paymentId): bool
    {
        if (!$this->isConfigured()) {
            return false;
        }

        try {
            $response = Http::timeout(15)->withHeaders([
                'Authorization' => 'Bearer ' . $this->apiKey,
                'Content-Type' => 'application/json',
            ])->post("{$this->baseUrl}/Confirm", [
                'TerminalKey' => config('services.tinkoff.terminal_key', ''),
                'PaymentId'   => $paymentId,
            ]);

            $data = $response->json();
            return ($data['Success'] ?? false) === true;

        } catch (\Throwable $e) {
            Log::error('SBP: Confirm failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Handle Tinkoff webhook (notification URL).
     */
    public function handleWebhook(array $payload): array
    {
        $terminalKey = $payload['TerminalKey'] ?? '';
        $orderId = $payload['OrderId'] ?? '';
        $paymentId = $payload['PaymentId'] ?? '';
        $status = $payload['Status'] ?? '';
        $amount = ($payload['Amount'] ?? 0) / 100;

        // Verify token
        $token = $payload['Token'] ?? '';
        if (!$this->verifyWebhookToken($payload, $token)) {
            Log::warning('SBP: Webhook token verification failed', ['order_id' => $orderId]);
            return ['success' => false, 'error' => 'Invalid token'];
        }

        $mappedStatus = match ($status) {
            'AUTHORIZED' => 'paid',
            'CONFIRMED'  => 'confirmed',
            'REJECTED'   => 'rejected',
            'REFUNDED'   => 'refunded',
            default      => 'pending',
        };

        // Find the SBP payment by order_id or payment_id
        $sbpPayment = SbpPayment::where('provider_payment_id', $paymentId)
            ->orWhere('order_id', $orderId)
            ->first();

        if ($sbpPayment) {
            $sbpPayment->update([
                'status'         => $mappedStatus,
                'paid_at'        => in_array($mappedStatus, ['paid', 'confirmed']) ? now() : null,
                'provider_response' => json_encode($payload),
            ]);

            // Auto-confirm: when Tinkoff sends AUTHORIZED, automatically confirm
            // the payment so funds are captured and SellRequest is completed.
            if ($mappedStatus === 'paid' && $this->isConfigured() && $paymentId) {
                $confirmed = $this->confirmPayment($paymentId);
                if ($confirmed) {
                    $sbpPayment->update([
                        'status'        => 'confirmed',
                        'confirmed_at'  => now(),
                    ]);
                    $mappedStatus = 'confirmed';
                    Log::info('SBP: Auto-confirmed AUTHORIZED payment', [
                        'order_id'   => $orderId,
                        'payment_id' => $paymentId,
                    ]);
                } else {
                    Log::warning('SBP: Auto-confirm failed for AUTHORIZED payment', [
                        'order_id'   => $orderId,
                        'payment_id' => $paymentId,
                    ]);
                }
            }

            // Auto-complete linked SellRequest when payment is confirmed
            if ($mappedStatus === 'confirmed') {
                $this->completeLinkedSellRequest($sbpPayment);
            }
        }

        Log::info('SBP: Webhook processed', [
            'order_id' => $orderId,
            'status' => $mappedStatus,
            'amount' => $amount,
        ]);

        return ['success' => true, 'status' => $mappedStatus];
    }

    /**
     * Auto-complete the linked SellRequest when SBP payment is confirmed.
     */
    public function completeLinkedSellRequest(SbpPayment $sbpPayment): bool
    {
        if ($sbpPayment->payable_type !== 'App\\Models\\SellRequest' || !$sbpPayment->payable_id) {
            return false;
        }

        $sellRequest = \App\Models\SellRequest::find($sbpPayment->payable_id);
        if (!$sellRequest || (int)$sellRequest->status !== 2) {
            return false;
        }

        $sellRequest->update(['status' => 3]); // 3 = completed

        $amount = getBaseAmount($sellRequest->final_amount, optional($sellRequest->getCurrency)->code, 'fiat');
        \Facades\App\Services\BasicService::makeTransaction(
            $amount, 0, '+', 'Crypto Sell Complete',
            $sellRequest->id, \App\Models\SellRequest::class,
            $sellRequest->user_id, $sellRequest->final_amount,
            optional($sellRequest->getCurrency)->code
        );

        Log::info('SBP: Auto-completed SellRequest', [
            'sell_request_id' => $sellRequest->id,
            'utr'            => $sellRequest->utr,
            'sbp_payment_id' => $sbpPayment->id,
        ]);

        return true;
    }

    /**
     * Build NSPK QR payload string.
     * Standard format: ST0001|bankName=...|bankBik=...|account=...|name=...|inn=...|amount=...|purpose=...
     */
    private function buildNspkPayload(string $bankId, string $account, string $name, string $inn, float $amount, string $purpose): string
    {
        $parts = [
            'ST0001',           // Version
            'bankName=' . ($bankId ?: 'TINKOFF'),
            'personalAcc=' . $account,
            'name=' . ($name ?: 'SolidChange'),
            'inn=' . $inn,
        ];

        if ($amount > 0) {
            $parts[] = 'amount=' . number_format($amount, 2, '.', '');
        }

        if ($purpose) {
            $parts[] = 'purpose=' . $purpose;
        }

        return implode('|', $parts);
    }

    /**
     * Generate NSPK QR URL from payload.
     * Uses the public NSPK QR generation API.
     */
    private function generateNspkQrUrl(string $payload): string
    {
        $encoded = base64_encode($payload);
        return "https://qr.nspk.ru/{$encoded}";
    }

    /**
     * Verify Tinkoff webhook token.
     */
    private function verifyWebhookToken(array $payload, string $token): bool
    {
        if (empty($token)) {
            return false;
        }

        $password = config('services.tinkoff.password', '');
        if (empty($password)) {
            return false;
        }

        // Tinkoff token algorithm: sort all fields alphabetically, concatenate values + password, SHA-256
        $sorted = collect($payload)
            ->except(['Token', 'DATA'])
            ->filter(fn($v) => $v !== null && $v !== '')
            ->sortKeys()
            ->implode('');

        $expectedToken = hash('sha256', $sorted . $password);

        return hash_equals($expectedToken, strtolower($token));
    }

    /**
     * Generate a QR code image as SVG (for inline display).
     * Simple QR generator without external library.
     */
    public function generateQrSvg(string $data, int $size = 256): string
    {
        // Use a public QR API for now; in production, use a proper QR library
        $qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/';
        $qrImageUrl = $qrApiUrl . '?size=' . $size . 'x' . $size . '&data=' . urlencode($data);

        // Return an SVG with embedded image
        return '<img src="' . $qrImageUrl . '" alt="SBP QR" width="' . $size . '" height="' . $size . '" style="image-rendering: pixelated;" />';
    }
}
