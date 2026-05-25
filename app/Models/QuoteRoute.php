<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class QuoteRoute extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'reference_price' => 'decimal:12',
        'client_price' => 'decimal:12',
        'markup_percent' => 'decimal:6',
        'slippage_percent' => 'decimal:6',
        'expected_profit_amount' => 'decimal:8',
        'expires_at' => 'datetime',
        'metadata' => 'array',
    ];

    public function quotable()
    {
        return $this->morphTo();
    }
}
