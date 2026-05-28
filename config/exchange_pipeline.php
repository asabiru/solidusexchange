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
        'provider' => env('EXCHANGE_AML_PROVIDER', 'local_db'),
        'auto_block_processing' => env('EXCHANGE_AML_AUTO_BLOCK_PROCESSING', true),
        'local_sources_path' => env('EXCHANGE_AML_LOCAL_SOURCES_PATH', database_path('data/aml_sources')),
        'local_feeds_manifest_path' => env('EXCHANGE_AML_LOCAL_FEEDS_MANIFEST_PATH', database_path('data/aml_feeds/feeds.json')),
        'local_feed_timeout' => (int) env('EXCHANGE_AML_LOCAL_FEED_TIMEOUT', 20),
        'api_key' => env('EXCHANGE_AML_API_KEY'),
        'api_secret' => env('EXCHANGE_AML_API_SECRET'),
        'api_url' => env('EXCHANGE_AML_API_URL'),
        'elliptic_base_url' => env('ELLIPTIC_AML_BASE_URL', 'https://aml-api.elliptic.co/v2'),
    ],
    'routing' => [
        'internal_matching_enabled' => env('EXCHANGE_INTERNAL_MATCHING_ENABLED', false),
        'require_async_payout_for_auto_match' => env('EXCHANGE_INTERNAL_MATCHING_REQUIRE_ASYNC_PAYOUT', true),
        'netting_window_minutes' => (int) env('EXCHANGE_INTERNAL_MATCHING_WINDOW_MINUTES', 15),
    ],
];
