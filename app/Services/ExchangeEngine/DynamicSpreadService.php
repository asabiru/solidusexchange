<?php

namespace App\Services\ExchangeEngine;

use App\Models\SpreadRule;

class DynamicSpreadService
{
    public function resolve(string $pair, float $amount, string $route = 'external_hedge', string $sourceChannel = 'web'): array
    {
        $rule = SpreadRule::query()
            ->where('is_active', true)
            ->where(function ($query) use ($pair) {
                $query->whereNull('pair')->orWhere('pair', $pair);
            })
            ->where(function ($query) use ($route) {
                $query->whereNull('route')->orWhere('route', $route);
            })
            ->where(function ($query) use ($sourceChannel) {
                $query->whereNull('source_channel')->orWhere('source_channel', $sourceChannel);
            })
            ->where(function ($query) use ($amount) {
                $query->whereNull('min_amount')->orWhere('min_amount', '<=', $amount);
            })
            ->where(function ($query) use ($amount) {
                $query->whereNull('max_amount')->orWhere('max_amount', '>=', $amount);
            })
            ->orderBy('priority')
            ->first();

        return [
            'markup_percent' => (float) ($rule->markup_percent ?? config('exchange_engine.markup_percent', 1.0)),
            'slippage_percent' => (float) ($rule->slippage_percent ?? config('exchange_engine.slippage_percent', 0.2)),
            'min_profit_percent' => (float) ($rule->min_profit_percent ?? 0),
            'spread_rule_id' => $rule?->id,
        ];
    }
}
