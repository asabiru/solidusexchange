<?php

return [
    'deposit_provider' => env('EXCHANGE_PIPELINE_DEPOSIT_PROVIDER', 'custodial'),
    'payout_provider' => env('EXCHANGE_PIPELINE_PAYOUT_PROVIDER', 'custodial'),
    'treasury' => [
        'watch_provider' => env('EXCHANGE_TREASURY_WATCH_PROVIDER', 'none'),
        'require_watch_subscription' => env('EXCHANGE_TREASURY_REQUIRE_WATCH_SUBSCRIPTION', false),
    ],
    'aml' => [
        'enabled' => env('EXCHANGE_AML_ENABLED', true),
        // Supported providers: 'amlbot', 'manual', 'disabled'
        'provider' => env('EXCHANGE_AML_PROVIDER', 'manual'),
        'auto_block_processing' => env('EXCHANGE_AML_AUTO_BLOCK_PROCESSING', true),
        // AMLBot API key (https://amlbot.com)
        'api_key' => env('AMLBOT_API_KEY'),
    ],
    'routing' => [
        'internal_matching_enabled' => env('EXCHANGE_INTERNAL_MATCHING_ENABLED', false),
        'require_async_payout_for_auto_match' => env('EXCHANGE_INTERNAL_MATCHING_REQUIRE_ASYNC_PAYOUT', true),
        'netting_window_minutes' => (int) env('EXCHANGE_INTERNAL_MATCHING_WINDOW_MINUTES', 15),
    ],
];
