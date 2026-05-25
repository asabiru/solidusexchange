<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WalletPool extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'max_balance' => 'decimal:8',
        'min_balance' => 'decimal:8',
        'auto_sweep_threshold' => 'decimal:8',
    ];
}
