<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('crypto_currencies')) {
            return;
        }

        $icons = [
            'BTC' => 'btc.svg',
            'ETH' => 'eth.svg',
            'ETH_ARB' => 'eth-arb.svg',
            'ETH_BASE' => 'eth-base.svg',
            'ETH_OPT' => 'eth-opt.svg',
            'BNB' => 'bnb.svg',
            'LTC' => 'ltc.svg',
            'SOL' => 'sol.svg',
            'TON' => 'ton.svg',
            'TRX' => 'trx.svg',
            'USDC_ARB' => 'usdc-arb.svg',
            'USDC_BASE' => 'usdc-base.svg',
            'USDC_BSC' => 'usdc-bsc.svg',
            'USDC_ERC20' => 'usdc-erc20.svg',
            'USDC_OPT' => 'usdc-opt.svg',
            'USDC_SOL' => 'usdc-sol.svg',
            'USDT_ARB' => 'usdt-arb.svg',
            'USDT_BSC' => 'usdt-bsc.svg',
            'USDT_ERC20' => 'usdt-erc20.svg',
            'USDT_OPT' => 'usdt-opt.svg',
            'USDT_SOL' => 'usdt-sol.svg',
            'USDT_TON' => 'usdt-ton.svg',
            'USDT_TRC20' => 'usdt-trc20.svg',
        ];

        foreach ($icons as $code => $file) {
            DB::table('crypto_currencies')
                ->where('code', $code)
                ->update([
                    'driver' => 'local',
                    'image' => 'cryptoCurrency/' . $file,
                ]);
        }
    }

    public function down(): void
    {
    }
};
