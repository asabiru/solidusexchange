<?php

/*
|--------------------------------------------------------------------------
| All-in Rate Pricing Configuration
|--------------------------------------------------------------------------
| Every cost (AML, KYC, NSPK, USN tax, network fee, margin) is folded into
| the single exchange rate shown to the client. No separate fee line items.
| See App\Services\Pricing\PricingService.
*/

return [
    // Master switch. While false, legacy fee model stays active.
    'all_in_rate_enabled' => env('PRICING_ALL_IN_RATE_ENABLED', false),

    // Verification costs (USD). AML charged on every trade; KYC once per client.
    'verification' => [
        'aml_fee_usd' => (float) env('PRICING_AML_FEE_USD', 1.0),
        'kyc_fee_usd' => (float) env('PRICING_KYC_FEE_USD', 1.0),
    ],

    // USN "доход минус расход" tax (percent). Applied only when gateway profile apply_tax = true.
    'usn_tax_percent' => (float) env('PRICING_USN_TAX_PERCENT', 15.0),

    // NSPK / SBP operator fee (percent of fiat). Applied only when gateway profile apply_nspk = true.
    'nspk_percent' => (float) env('PRICING_NSPK_PERCENT', 3.0),

    // Cost profile per payment gateway id.
    'gateway_profiles' => [
        1000 => ['label' => 'bank_ip',  'apply_nspk' => false, 'apply_tax' => true],
        1001 => ['label' => 'sbp_qr_ip','apply_nspk' => true,  'apply_tax' => true],
        1002 => ['label' => 'p2p',      'apply_nspk' => false, 'apply_tax' => false],
    ],

    // Target NET profit percent per direction (overridable per currency below).
    'margin_percent' => [
        'buy'      => (float) env('PRICING_MARGIN_BUY', 2.0),
        'sell'     => (float) env('PRICING_MARGIN_SELL', 2.0),
        'exchange' => (float) env('PRICING_MARGIN_EXCHANGE', 2.0),
    ],

    // Network send fee per coin/network, in COIN units (cost paid from custodial on payout).
    'network_fee_coin' => [
        'USDT_TRC20' => (float) env('PRICING_NETFEE_USDT_TRC20', 1.5),
        'USDT_ERC20' => (float) env('PRICING_NETFEE_USDT_ERC20', 8.0),
        'USDT_BSC'   => (float) env('PRICING_NETFEE_USDT_BSC', 0.8),
        'TRX'        => (float) env('PRICING_NETFEE_TRX', 2.0),
    ],

    // Per-currency margin overrides keyed by crypto code, e.g. ['USDT_TRC20' => 2.5].
    'margin_overrides' => [],
];
