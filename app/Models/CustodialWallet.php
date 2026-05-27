<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodialWallet extends Model
{
    use HasFactory;

    protected $fillable = [
        'currency_code', 'network', 'address', 'derivation_path',
        'provider', 'provider_reference', 'purpose', 'status',
        'assigned_exchange_id', 'assigned_at',
        'last_deposit_at', 'last_deposit_tx_id', 'last_deposit_amount',
    ];

    protected $casts = [
        'assigned_at' => 'datetime',
        'last_deposit_at' => 'datetime',
        'last_deposit_amount' => 'decimal:8',
    ];

    public function assignedExchange()
    {
        return $this->belongsTo(ExchangeRequest::class, 'assigned_exchange_id');
    }

    public function deposits()
    {
        return $this->hasMany(CustodialDeposit::class, 'custodial_wallet_id');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeAvailable($query)
    {
        return $query->where('status', 'active')->whereNull('assigned_exchange_id');
    }

    public function scopeForCurrency($query, string $code)
    {
        return $query->where('currency_code', strtoupper(trim($code)));
    }

    public function isAvailable(): bool
    {
        return $this->status === 'active' && blank($this->assigned_exchange_id);
    }
}
