<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        // Deactivate all existing crypto methods
        DB::table('crypto_methods')->update(['status' => 0]);

        // Insert the custodial HD wallet method as the active provider
        DB::table('crypto_methods')->updateOrInsert(
            ['code' => 'custodial'],
            [
                'name' => 'Custodial HD Wallets',
                'parameters' => json_encode([]),
                'extra_parameters' => null,
                'description' => 'Generates unique HD-derived deposit addresses for each exchange request. Deposits are monitored by the custodial:monitor-deposits cron job. Supports BTC, ETH, USDT_TRC20, USDT_TON, BNB, SOL, TON, LTC and all EVM/TRC20/BEP20 tokens.',
                'status' => 1,
                'is_automatic' => 1,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );
    }

    public function down(): void
    {
        DB::table('crypto_methods')->where('code', 'custodial')->delete();
    }
};
