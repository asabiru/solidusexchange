<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CustodialWithdrawal extends Model
{
    protected $fillable = [
        'custodial_wallet_id',
        'currency_code',
        'from_address',
        'to_address',
        'amount',
        'fee',
        'txid',
        'status',
        'error',
        'note',
        'executed_at',
    ];

    protected $casts = [
        'amount'      => 'decimal:8',
        'fee'         => 'decimal:8',
        'executed_at' => 'datetime',
    ];

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(CustodialWallet::class, 'custodial_wallet_id');
    }
}
