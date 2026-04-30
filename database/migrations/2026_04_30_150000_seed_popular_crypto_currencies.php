<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        $config = config('popular_crypto_currencies');
        $defaults = $config['defaults'] ?? [];
        $currencies = $config['currencies'] ?? [];

        if ($currencies === []) {
            return;
        }

        $now = Carbon::now();
        $sortBy = (int) DB::table('crypto_currencies')->max('sort_by');

        foreach ($currencies as $currency) {
            $existing = DB::table('crypto_currencies')
                ->where('code', $currency['code'])
                ->first();

            $payload = array_merge($defaults, $currency);

            if ($existing) {
                $updates = [
                    'name' => $existing->name ?: $payload['name'],
                    'symbol' => $existing->symbol ?: $payload['symbol'],
                    'is_stablecoin' => $existing->is_stablecoin ?? $payload['is_stablecoin'],
                    'sort_by' => (int) ($existing->sort_by ?? 0) > 0 ? $existing->sort_by : ++$sortBy,
                    'updated_at' => $now,
                ];

                DB::table('crypto_currencies')
                    ->where('id', $existing->id)
                    ->update($updates);

                continue;
            }

            DB::table('crypto_currencies')->insert([
                'name' => $payload['name'],
                'code' => $payload['code'],
                'symbol' => $payload['symbol'],
                'rate' => $payload['is_stablecoin'] ? 1 : 0,
                'usd_rate' => $payload['is_stablecoin'] ? 1 : 0,
                'service_fee' => $payload['service_fee'],
                'service_fee_type' => $payload['service_fee_type'],
                'network_fee' => $payload['network_fee'],
                'network_fee_type' => $payload['network_fee_type'],
                'min_send' => $payload['min_send'],
                'max_send' => $payload['max_send'],
                'image' => $payload['image'],
                'driver' => $payload['driver'],
                'status' => $payload['status'],
                'sort_by' => ++$sortBy,
                'is_stablecoin' => $payload['is_stablecoin'],
                'last_rate_sync_at' => null,
                'last_rate_sync_error' => $payload['last_rate_sync_error'] ?? null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        // Preserve production currency settings on rollback. Operators can disable
        // or remove specific rows manually if they no longer want the seeded set.
    }
};
