<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PnlLedger extends Model
{
    use HasFactory;

    protected $table = 'pnl_ledger';

    protected $guarded = ['id'];

    protected $casts = [
        'expected_amount' => 'decimal:8',
        'realized_amount' => 'decimal:8',
        'fee_amount' => 'decimal:8',
        'metadata' => 'array',
    ];

    public function pnlable()
    {
        return $this->morphTo();
    }
}
