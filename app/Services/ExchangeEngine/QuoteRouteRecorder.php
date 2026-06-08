<?php

namespace App\Services\ExchangeEngine;

use App\Models\QuoteRoute;
use Illuminate\Database\Eloquent\Model;

class QuoteRouteRecorder
{
    public function record(Model $quotable, array $quote, string $route): QuoteRoute
    {
        return QuoteRoute::create([
            'quotable_type' => $quotable::class,
            'quotable_id' => $quotable->getKey(),
            'pair' => (string) ($quote['quote_symbol'] ?? ''),
            'route' => $route,
            'provider' => $quote['quote_provider'] ?? null,
            'reference_price' => $quote['quote_reference_price'] ?? null,
            'client_price' => $quote['quote_price'] ?? null,
            'markup_percent' => $quote['quote_markup_percent'] ?? null,
            'slippage_percent' => $quote['quote_slippage_percent'] ?? null,
            'expected_profit_amount' => $quote['expected_profit_amount'] ?? null,
            'profit_currency' => $quote['profit_currency'] ?? null,
            'expires_at' => $quote['quote_expires_at'] ?? null,
            'metadata' => $quote,
        ]);
    }
}
