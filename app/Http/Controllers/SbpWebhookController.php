<?php

namespace App\Http\Controllers;

use App\Services\Sbp\SbpQrService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class SbpWebhookController extends Controller
{
    /**
     * Handle Tinkoff payment notification webhook.
     * This URL is registered in Tinkoff business panel as the notification URL.
     */
    public function tinkoffNotify(Request $request)
    {
        $payload = $request->all();

        Log::info('SBP: Tinkoff webhook received', [
            'order_id' => $payload['OrderId'] ?? null,
            'status' => $payload['Status'] ?? null,
        ]);

        try {
            $service = app(SbpQrService::class);
            $result = $service->handleWebhook($payload);

            if ($result['success']) {
                // Tinkoff expects "OK" response
                return response('OK', 200);
            }

            return response('ERROR', 400);

        } catch (\Throwable $e) {
            Log::error('SBP: Webhook processing failed: ' . $e->getMessage());
            return response('ERROR', 500);
        }
    }

    /**
     * Check SBP payment status (called by frontend polling).
     */
    public function checkStatus(Request $request, $orderId)
    {
        $payment = \App\Models\SbpPayment::where('order_id', $orderId)->first();

        if (!$payment) {
            return response()->json(['status' => 'not_found'], 404);
        }

        // If we have a Tinkoff payment ID, check status via API
        if ($payment->provider_payment_id && $payment->provider === 'tinkoff') {
            $service = app(SbpQrService::class);
            $apiStatus = $service->checkPaymentStatus($payment->provider_payment_id);

            if ($apiStatus['status'] !== 'error' && $apiStatus['status'] !== $payment->status) {
                $payment->update([
                    'status' => $apiStatus['status'],
                    'paid_at' => in_array($apiStatus['status'], ['paid', 'confirmed']) ? now() : $payment->paid_at,
                ]);
            }
        }

        return response()->json([
            'status' => $payment->fresh()->status,
            'amount' => $payment->amount,
            'paid_at' => $payment->paid_at?->toIso8601String(),
        ]);
    }
}
