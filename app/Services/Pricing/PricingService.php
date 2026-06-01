<?php

namespace App\Services\Pricing;

use RuntimeException;

/**
 * All-in rate pricing engine.
 *
 * Folds every cost (AML, KYC, NSPK, USN tax, network send fee, margin) into a
 * single client exchange rate. The client only ever sees the rate and the
 * amount they receive — no separate fee line items. Each cost component is
 * returned in the breakdown for internal accounting (USN доход-минус-расход).
 *
 * Pure calculation — no DB, no side effects. Callers pass resolved inputs.
 */
class PricingService
{
    /**
     * Compute an all-in BUY quote (client pays fiat R, receives crypto U).
     *
     * @param array $p {
     *   fiat_amount:        float  R, fiat the client pays
     *   market_price:       float  P, market fiat-per-1-coin (no margin)
     *   usd_fiat_rate:      float  fiat per 1 USD (to convert USD costs)
     *   margin_percent:     float  target NET profit, % of R
     *   network_fee_coin:   float  network send fee in COIN units
     *   apply_nspk:         bool
     *   nspk_percent:       float
     *   apply_tax:          bool
     *   tax_percent:        float  USN %
     *   aml_fee_usd:        float  charged every trade
     *   kyc_fee_usd:        float  charged once (pass 0 if client already KYC'd)
     * }
     * @return array rate, get_amount, breakdown
     */
    public function computeBuyQuote(array $p): array
    {
        $R     = (float) ($p['fiat_amount'] ?? 0);
        $P     = (float) ($p['market_price'] ?? 0);
        $usd   = (float) ($p['usd_fiat_rate'] ?? 0);
        $m     = max(0.0, (float) ($p['margin_percent'] ?? 0)) / 100;
        $net   = (float) ($p['network_fee_coin'] ?? 0);
        $nspk  = !empty($p['apply_nspk']) ? max(0.0, (float) ($p['nspk_percent'] ?? 0)) / 100 : 0.0;
        $taxOn = !empty($p['apply_tax']);
        $tax   = $taxOn ? max(0.0, (float) ($p['tax_percent'] ?? 0)) / 100 : 0.0;
        $aml   = max(0.0, (float) ($p['aml_fee_usd'] ?? 0));
        $kyc   = max(0.0, (float) ($p['kyc_fee_usd'] ?? 0));

        if ($R <= 0 || $P <= 0) {
            throw new RuntimeException('fiat_amount and market_price must be > 0.');
        }
        if ($tax >= 1.0) {
            throw new RuntimeException('tax_percent must be < 100.');
        }

        // Required pre-tax profit so that net profit (after USN) equals m*R.
        $preTaxProfit = $taxOn ? ($m * $R) / (1 - $tax) : ($m * $R);

        // Fixed/percent costs expressed in fiat.
        $verificationFiat = ($aml + $kyc) * $usd;     // USD costs -> fiat
        $nspkFiat         = $nspk * $R;               // % of incoming fiat
        $networkFiat      = $net * $P;                // network send fee in fiat

        // Fiat left to spend on acquiring the coin we send.
        $coinSpendFiat = $R - $preTaxProfit - $nspkFiat - $verificationFiat - $networkFiat;

        if ($coinSpendFiat <= 0) {
            throw new RuntimeException('Costs exceed fiat amount; increase amount or reduce margin/costs.');
        }

        $U = $coinSpendFiat / $P;          // coin delivered to client
        $clientRate = $R / $U;             // all-in fiat per 1 coin

        // Tax base = revenue - expenses (USN доход-расход).
        $expenses     = $coinSpendFiat + $nspkFiat + $verificationFiat + $networkFiat;
        $taxAmountFiat = $taxOn ? $tax * max(0.0, $R - $expenses) : 0.0;
        $netProfitFiat = ($R - $expenses) - $taxAmountFiat;

        return [
            'fiat_amount'   => round($R, 2),
            'market_price'  => $P,
            'rate'          => $clientRate,
            'get_amount'    => $U,
            'breakdown'     => [
                'nspk_fiat'         => round($nspkFiat, 4),
                'aml_kyc_fiat'      => round($verificationFiat, 4),
                'network_fee_coin'  => $net,
                'network_fee_fiat'  => round($networkFiat, 4),
                'tax_fiat'          => round($taxAmountFiat, 4),
                'net_profit_fiat'   => round($netProfitFiat, 4),
                'coin_cost_fiat'    => round($coinSpendFiat, 4),
            ],
        ];
    }
}
