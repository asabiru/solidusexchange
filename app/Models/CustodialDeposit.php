<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodialDeposit extends Model
{
    use HasFactory;

    protected $fillable = [
        'custodial_wallet_id', 'currency_code', 'tx_id', 'tx_hash',
        'amount', 'confirmations', 'status', 'source_address',
        'exchange_request_id', 'buy_request_id', 'sell_request_id',
        'detected_at', 'confirmed_at', 'aml_checked_at',
        'aml_provider', 'aml_risk_level', 'aml_risk_score', 'aml_notes',
    ];

    protected $casts = [
        'amount' => 'decimal:8',
        'aml_risk_score' => 'decimal:2',
        'detected_at' => 'datetime',
        'confirmed_at' => 'datetime',
        'aml_checked_at' => 'datetime',
    ];

    public function custodialWallet()
    {
        return $this->belongsTo(CustodialWallet::class, 'custodial_wallet_id');
    }

    public function exchangeRequest()
    {
        return $this->belongsTo(ExchangeRequest::class);
    }

    public function buyRequest()
    {
        return $this->belongsTo(BuyRequest::class);
    }

    public function sellRequest()
    {
        return $this->belongsTo(SellRequest::class);
    }

    public function isAmlApproved(): bool
    {
        return in_array($this->aml_risk_level, ['low', 'medium'], true)
            || $this->status === 'aml_approved';
    }

    public function isAmlRejected(): bool
    {
        return $this->aml_risk_level === 'high'
            || $this->status === 'aml_rejected';
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeConfirmed($query)
    {
        return $query->where('status', 'confirmed');
    }

    public function scopeAmlCheck($query)
    {
        return $query->where('status', 'aml_check');
    }
}
