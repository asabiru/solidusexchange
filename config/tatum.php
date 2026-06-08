<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Tatum.io Configuration
    |--------------------------------------------------------------------------
    |
    | Tatum provides RPC nodes, blockchain notifications (webhooks),
    | and data APIs for 130+ networks.
    |
    | Dashboard: https://dashboard.tatum.io
    | API Docs:  https://docs.tatum.io
    */

    'api_key'        => env('TATUM_API_KEY', ''),
    'api_url'        => env('TATUM_API_URL', 'https://api.tatum.io/v4'),
    'webhook_secret' => env('TATUM_WEBHOOK_SECRET', ''),
    'testnet'        => env('TATUM_TESTNET', false),

    /*
    |--------------------------------------------------------------------------
    | Webhook URL
    |--------------------------------------------------------------------------
    | URL where Tatum will POST incoming transaction notifications.
    | Must be publicly accessible. Example:
    |   https://solidchange.online/api/tatum/webhook
    */
    'webhook_url' => env('TATUM_WEBHOOK_URL', ''),

    /*
    |--------------------------------------------------------------------------
    | Chain Mapping
    |--------------------------------------------------------------------------
    | Maps internal currency codes → Tatum chain identifiers
    */
    'chains' => [
        // Native coins
        'BTC'         => 'bitcoin-mainnet',
        'LTC'         => 'litecoin-mainnet',
        'ETH'         => 'ethereum-mainnet',
        'BNB'         => 'bsc-mainnet',
        'TRX'         => 'tron-mainnet',
        'SOL'         => 'solana-mainnet',
        'TON'         => 'ton-mainnet',
        'MATIC'       => 'polygon-mainnet',
        'XRP'         => 'xrp-mainnet',

        // USDT variants
        'USDT'        => 'ethereum-mainnet',
        'USDT_TRC20'  => 'tron-mainnet',
        'USDT_BSC'    => 'bsc-mainnet',
        'USDT_TON'    => 'ton-mainnet',
        'USDT_SOL'    => 'solana-mainnet',
        'USDT_MATIC'  => 'polygon-mainnet',

        // USDC variants
        'USDC'        => 'ethereum-mainnet',
        'USDC_BSC'    => 'bsc-mainnet',
        'USDC_SOL'    => 'solana-mainnet',

        // Other tokens
        'SHIB'        => 'ethereum-mainnet',
        'PEPE'        => 'ethereum-mainnet',
        'ARB'         => 'arbitrum-one-mainnet',
        'OP'          => 'optimism-mainnet',
    ],

    /*
    |--------------------------------------------------------------------------
    | Token Contract Addresses (for ERC20/TRC20/etc tokens)
    |--------------------------------------------------------------------------
    */
    'contracts' => [
        // ERC-20
        'USDT'       => '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        'USDC'       => '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'SHIB'       => '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
        'PEPE'       => '0x6982508145454Ce325dDbE47a25d4ec3d2311933',

        // TRC-20
        'USDT_TRC20' => 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        'USDC_TRC20' => 'TEkxiTehnz8SeLqQs3vFq4z7LmYqYR7vRk',

        // BSC (BEP-20)
        'USDT_BSC'   => '0x55d398326f99059fF775485246999027B3197955',
        'USDC_BSC'   => '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',

        // TON Jettons
        'USDT_TON'   => env('CUSTODIAL_USDT_TON_JETTON', 'EQCxF6145v3R7rU4EoLmD5JD3t4c2GqBv5vL6cRt5Qq7Hv2m'),

        // Polygon
        'USDT_MATIC' => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        'USDC_MATIC' => '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    ],

    /*
    |--------------------------------------------------------------------------
    | Minimum Confirmations
    |--------------------------------------------------------------------------
    */
    'min_confirmations' => [
        'bitcoin-mainnet'   => (int) env('TATUM_MIN_CONF_BTC',  3),
        'litecoin-mainnet'  => (int) env('TATUM_MIN_CONF_LTC',  6),
        'ethereum-mainnet'  => (int) env('TATUM_MIN_CONF_ETH',  12),
        'bsc-mainnet'       => (int) env('TATUM_MIN_CONF_BSC',  12),
        'tron-mainnet'      => (int) env('TATUM_MIN_CONF_TRX',  20),
        'solana-mainnet'    => (int) env('TATUM_MIN_CONF_SOL',  32),
        'ton-mainnet'       => (int) env('TATUM_MIN_CONF_TON',  1),
        'polygon-mainnet'   => (int) env('TATUM_MIN_CONF_MATIC', 128),
        'arbitrum-one-mainnet' => (int) env('TATUM_MIN_CONF_ARB', 64),
    ],
];
