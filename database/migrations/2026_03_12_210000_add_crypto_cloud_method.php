<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        DB::table('crypto_methods')->updateOrInsert(
            ['code' => 'crypto_cloud'],
            [
                'name' => 'CryptoCloud',
                'parameters' => json_encode([
                    'api_key' => '',
                    'shop_id' => '',
                    'secret_key' => '',
                    'payout_api_key' => '',
                    'currency_map' => "USDT=USDT_TRC20\nUSDC=USDC_ERC20",
                ]),
                'extra_parameters' => null,
                'description' => 'CryptoCloud works as an automatic crypto processor with static wallet deposits, POSTBACK notifications and payout API.<br><br>Create a project in <a href="https://cryptocloud.plus" target="_blank">CryptoCloud <i class="fas fa-external-link-alt"></i></a>, then copy API KEY, SHOP ID and SECRET KEY from the project settings. Generate PAYOUT API KEY in the Security section. In project notifications set the URL to <code>/api/deposit/webhook/crypto_cloud</code> on your public domain. Use <code>currency_map</code> to map project codes to provider codes, for example <code>USDT=USDT_TRC20</code>.',
                'status' => 0,
                'is_automatic' => 1,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );
    }

    public function down(): void
    {
        DB::table('crypto_methods')->where('code', 'crypto_cloud')->delete();
    }
};
