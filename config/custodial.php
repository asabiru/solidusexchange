<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Custodial Wallet Configuration
    |--------------------------------------------------------------------------
    |
    | Free blockchain API endpoints for deposit monitoring.
    | These are public APIs with no API key required (or free tier).
    |
    */

    // Bitcoin (Blockstream — free, no key needed)
    'btc_api' => env('CUSTODIAL_BTC_API', 'https://blockstream.info/api'),

    // Litecoin (litecoin.space — free, same API format as Blockstream)
    'ltc_api' => env('CUSTODIAL_LTC_API', 'https://litecoin.space/api'),

    // Ethereum / EVM chains (public RPC — free)
    'eth_rpc' => env('CUSTODIAL_ETH_RPC', 'https://eth.llamarpc.com'),
    'arb_rpc' => env('CUSTODIAL_ARB_RPC', 'https://arbitrum.llamarpc.com'),
    'opt_rpc' => env('CUSTODIAL_OPT_RPC', 'https://optimism.llamarpc.com'),
    'base_rpc' => env('CUSTODIAL_BASE_RPC', 'https://base.llamarpc.com'),

    // BNB Smart Chain (public RPC — free)
    'bsc_rpc' => env('CUSTODIAL_BSC_RPC', 'https://bsc-dataseed.binance.org'),

    // Tron (TronGrid — free tier, API key recommended for higher limits)
    'trx_api' => env('CUSTODIAL_TRX_API', 'https://api.trongrid.io'),
    'trongrid_api_key' => env('CUSTODIAL_TRONGRID_API_KEY', ''),

    // Solana (public RPC — free)
    'sol_rpc' => env('CUSTODIAL_SOL_RPC', 'https://api.mainnet-beta.solana.com'),

    // TON (TON Center — free tier)
    'ton_api' => env('CUSTODIAL_TON_API', 'https://toncenter.com/api/v2'),
    'ton_api_key' => env('CUSTODIAL_TON_API_KEY', ''),

    /*
    |--------------------------------------------------------------------------
    | TRC20 Token Contract Addresses
    |--------------------------------------------------------------------------
    */
    'trc20_contracts' => [
        'USDT_TRC20' => env('CUSTODIAL_USDT_TRC20_CONTRACT', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
        'USDC_TRC20' => env('CUSTODIAL_USDC_TRC20_CONTRACT', 'TEkxiTehnz8SeLqQs3vFq4z7LmYqYR7vRk'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Deposit Monitoring Settings
    |--------------------------------------------------------------------------
    */
    'min_confirmations' => [
        'BTC' => (int) env('CUSTODIAL_MIN_CONF_BTC', 3),
        'LTC' => (int) env('CUSTODIAL_MIN_CONF_LTC', 6),
        'ETH' => (int) env('CUSTODIAL_MIN_CONF_ETH', 12),
        'BNB' => (int) env('CUSTODIAL_MIN_CONF_BNB', 12),
        'TRX' => (int) env('CUSTODIAL_MIN_CONF_TRX', 20),
        'SOL' => (int) env('CUSTODIAL_MIN_CONF_SOL', 32),
        'TON' => (int) env('CUSTODIAL_MIN_CONF_TON', 1),
    ],

    'scan_interval_seconds' => (int) env('CUSTODIAL_SCAN_INTERVAL', 30),
];
