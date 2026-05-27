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

    // Bitcoin (Blockstream-compatible public APIs)
    'btc_api' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_BTC_APIS', env('CUSTODIAL_BTC_API', 'https://blockstream.info/api|https://mempool.space/api')))
    ))),

    // Litecoin (Blockstream-compatible public APIs)
    'ltc_api' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_LTC_APIS', env('CUSTODIAL_LTC_API', 'https://litecoin.blockstream.info/api|https://mempool.space/ltc/api')))
    ))),

    // Ethereum / EVM chains (public RPC — free)
    'eth_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_ETH_RPCS', env('CUSTODIAL_ETH_RPC', 'https://ethereum-rpc.publicnode.com|https://eth.llamarpc.com|https://rpc.ankr.com/eth')))
    ))),
    'arb_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_ARB_RPCS', env('CUSTODIAL_ARB_RPC', 'https://arbitrum-rpc.publicnode.com|https://arb1.arbitrum.io/rpc')))
    ))),
    'opt_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_OPT_RPCS', env('CUSTODIAL_OPT_RPC', 'https://optimism-rpc.publicnode.com|https://mainnet.optimism.io')))
    ))),
    'base_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_BASE_RPCS', env('CUSTODIAL_BASE_RPC', 'https://base-rpc.publicnode.com|https://mainnet.base.org')))
    ))),

    // BNB Smart Chain (public RPC — free)
    'bsc_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_BSC_RPCS', env('CUSTODIAL_BSC_RPC', 'https://bsc-rpc.publicnode.com|https://bsc-dataseed.binance.org|https://rpc.ankr.com/bsc')))
    ))),

    // Tron (TronGrid-compatible public APIs)
    'trx_api' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_TRX_APIS', env('CUSTODIAL_TRX_API', 'https://api.trongrid.io|https://api.tronstack.io')))
    ))),
    'trongrid_api_key' => env('CUSTODIAL_TRONGRID_API_KEY', ''),

    // Solana (public RPC — free)
    'sol_rpc' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_SOL_RPCS', env('CUSTODIAL_SOL_RPC', 'https://api.mainnet-beta.solana.com|https://solana-rpc.publicnode.com|https://rpc.ankr.com/solana')))
    ))),

    // TON (TON Center-compatible APIs)
    'ton_api' => array_values(array_filter(array_map(
        'trim',
        explode('|', env('CUSTODIAL_TON_APIS', env('CUSTODIAL_TON_API', 'https://toncenter.com/api/v2')))
    ))),
    'ton_api_key' => env('CUSTODIAL_TON_API_KEY', ''),

    /*
    |--------------------------------------------------------------------------
    | TON Jetton Contracts
    |--------------------------------------------------------------------------
    |
    | Jetton master contracts for token monitoring on TON.
    | USDT_TON: EQCxF6145v3R7rU4EoLmD5JD3t4c2GqBv5vL6cRt5Qq7Hv2m (official Tether)
    */
    'ton_jettons' => [
        'USDT_TON' => env('CUSTODIAL_USDT_TON_JETTON', 'EQCxF6145v3R7rU4EoLmD5JD3t4c2GqBv5vL6cRt5Qq7Hv2m'),
    ],

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
        'USDT_TON' => (int) env('CUSTODIAL_MIN_CONF_USDT_TON', 1),
    ],

    'scan_interval_seconds' => (int) env('CUSTODIAL_SCAN_INTERVAL', 30),

    /*
    |--------------------------------------------------------------------------
    | HD Wallet Mnemonic
    |--------------------------------------------------------------------------
    |
    | The BIP39 mnemonic or hex seed used for HD wallet derivation.
    | IMPORTANT: This should NEVER be changed once wallets are generated,
    | as it would make all existing wallets inaccessible.
    |
    */
    'hd_mnemonic' => env('HD_WALLET_MNEMONIC', ''),
];
