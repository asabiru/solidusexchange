<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodyLedgerEntry extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'amount' => 'decimal:8',
        'balance_after' => 'decimal:8',
        'metadata' => 'array',
    ];

    public function ledgerable()
    {
        return $this->morphTo();
    }
}
