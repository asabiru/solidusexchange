<?php

return [
    'deposit_provider' => env('EXCHANGE_PIPELINE_DEPOSIT_PROVIDER', 'active_crypto_method'),
    'payout_provider' => env('EXCHANGE_PIPELINE_PAYOUT_PROVIDER', 'active_crypto_method'),
    'aml' => [
        'enabled' => env('EXCHANGE_AML_ENABLED', false),
        'provider' => env('EXCHANGE_AML_PROVIDER', 'manual'),
        'auto_block_processing' => env('EXCHANGE_AML_AUTO_BLOCK_PROCESSING', true),
    ],
];
