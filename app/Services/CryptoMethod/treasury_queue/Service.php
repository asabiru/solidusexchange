<?php

namespace App\Services\CryptoMethod\treasury_queue;

use App\Models\ExchangePayout;
use Illuminate\Support\Str;

class Service
{
    public function withdrawCrypto($object, $amount, $currency, $address, $type)
    {
        $payoutType = $type === 'refund' ? 'refund' : 'payout';

        $existing = ExchangePayout::where('exchange_request_id', $object->id)
            ->where('type', $payoutType)
            ->latest()
            ->first();

        if ($existing && in_array($existing->status, ['queued', 'processing', 'sent'], true)) {
            return true;
        }

        ExchangePayout::updateOrCreate(
            [
                'exchange_request_id' => $object->id,
                'type' => $payoutType,
            ],
            [
                'user_id' => $object->user_id,
                'provider' => 'treasury_queue',
                'currency_code' => strtoupper((string)$currency),
                'amount' => (float)$amount,
                'destination_wallet' => (string)$address,
                'status' => 'queued',
                'tx_id' => null,
                'external_reference' => substr('xp_' . Str::uuid()->toString(), 0, 191),
                'error_message' => null,
                'requested_at' => now(),
                'processed_at' => null,
            ]
        );

        return true;
    }
}
