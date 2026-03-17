<?php

return [
    'deposit_provider' => env('EXCHANGE_PIPELINE_DEPOSIT_PROVIDER', 'active_crypto_method'),
    'payout_provider' => env('EXCHANGE_PIPELINE_PAYOUT_PROVIDER', 'active_crypto_method'),
    'treasury' => [
        'watch_provider' => env('EXCHANGE_TREASURY_WATCH_PROVIDER', 'none'),
        'require_watch_subscription' => env('EXCHANGE_TREASURY_REQUIRE_WATCH_SUBSCRIPTION', true),
    ],
    'aml' => [
        'enabled' => env('EXCHANGE_AML_ENABLED', false),
        'provider' => env('EXCHANGE_AML_PROVIDER', 'manual'),
        'auto_block_processing' => env('EXCHANGE_AML_AUTO_BLOCK_PROCESSING', true),
    ],
];
