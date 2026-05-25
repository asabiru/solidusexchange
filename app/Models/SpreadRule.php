<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SpreadRule extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'min_amount' => 'decimal:8',
        'max_amount' => 'decimal:8',
        'markup_percent' => 'decimal:6',
        'slippage_percent' => 'decimal:6',
        'min_profit_percent' => 'decimal:6',
        'is_active' => 'boolean',
        'conditions' => 'array',
    ];
}
