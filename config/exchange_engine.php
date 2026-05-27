<?php

$supportedSendCurrencies = array_filter(array_map(
    static fn($value) => strtoupper(trim($value)),
    explode(',', (string)env('EXCHANGE_ENGINE_SUPPORTED_SEND_CURRENCIES', 'USDT'))
));

return [
    'enabled' => env('EXCHANGE_ENGINE_ENABLED', false),
    'driver' => env('EXCHANGE_ENGINE_DRIVER', 'bybit'),
    'supported_send_currencies' => array_values($supportedSendCurrencies),
    'fallback_to_internal_on_quote_error' => env('EXCHANGE_ENGINE_FALLBACK_TO_INTERNAL_ON_QUOTE_ERROR', true),
    'quote_ttl_seconds' => (int)env('EXCHANGE_ENGINE_QUOTE_TTL_SECONDS', 20),
    'markup_percent' => (float)env('EXCHANGE_ENGINE_MARKUP_PERCENT', 2.50),
    'min_profit_percent' => (float)env('EXCHANGE_ENGINE_MIN_PROFIT_PERCENT', 2.00),
    'execution_safety_buffer_percent' => (float)env('EXCHANGE_ENGINE_EXECUTION_SAFETY_BUFFER_PERCENT', 1.00),
    'slippage_percent' => (float)env('EXCHANGE_ENGINE_SLIPPAGE_PERCENT', 0.20),
    'trade_fee_percent' => (float)env('EXCHANGE_ENGINE_TRADE_FEE_PERCENT', 0.10),
    'auto_rebalance_with_bybit' => env('EXCHANGE_ENGINE_AUTO_REBALANCE_WITH_BYBIT', true),
    'auto_process_after_deposit' => env('EXCHANGE_ENGINE_AUTO_PROCESS_AFTER_DEPOSIT', true),
    'auto_payout_after_hedge' => env('EXCHANGE_ENGINE_AUTO_PAYOUT_AFTER_HEDGE', true),
    'bybit' => [
        'base_url' => env('BYBIT_BASE_URL', env('BYBIT_TESTNET', false) ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com'),
        'api_key' => env('BYBIT_API_KEY'),
        'api_secret' => env('BYBIT_API_SECRET'),
        'recv_window' => (int)env('BYBIT_RECV_WINDOW', 5000),
        'timeout' => (int)env('BYBIT_TIMEOUT', 10),
    ],
];
