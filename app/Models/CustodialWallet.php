<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodialWallet extends Model
{
    use HasFactory;

    protected $fillable = [
        'trader_id',
        'currency_code', 'network', 'address', 'derivation_path',
        'hd_wallet_index', 'encrypted_private_key',
        'provider', 'provider_reference', 'purpose', 'status',
        'assigned_exchange_id', 'assigned_at',
        'last_deposit_at', 'last_deposit_tx_id', 'last_deposit_amount',
        'balance',
        'last_checked_at',
    ];

    protected $casts = [
        'assigned_at' => 'datetime',
        'last_deposit_at' => 'datetime',
        'last_deposit_amount' => 'decimal:8',
        'balance' => 'decimal:8',
        'last_checked_at' => 'datetime',
    ];

    protected $hidden = ['encrypted_private_key'];

    public function trader()
    {
        return $this->belongsTo(Admin::class, 'trader_id');
    }

    public function assignedExchange()
    {
        return $this->belongsTo(ExchangeRequest::class, 'assigned_exchange_id');
    }

    public function scopeForTrader($query, int $traderId)
    {
        return $query->where('trader_id', $traderId);
    }

    public function scopePayout($query)
    {
        return $query->whereIn('purpose', ['payout', 'both']);
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
