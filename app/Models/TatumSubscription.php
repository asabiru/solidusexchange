<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TatumSubscription extends Model
{
    use HasFactory;

    protected $fillable = [
        'tatum_id',
        'wallet_id',
        'address',
        'chain',
        'currency_code',
        'type',
        'contract_address',
        'status',
    ];

    public function wallet()
    {
        return $this->belongsTo(CustodialWallet::class, 'wallet_id');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }
}
