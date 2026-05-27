<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SbpPayment extends Model
{
    protected $fillable = [
        'order_id', 'provider_payment_id', 'provider', 'amount', 'currency_code',
        'qr_url', 'qr_payload', 'status', 'purpose',
        'expires_at', 'paid_at', 'confirmed_at',
        'provider_response', 'meta',
        'payable_type', 'payable_id',
    ];

    protected $casts = [
        'amount'            => 'decimal:2',
        'expires_at'        => 'datetime',
        'paid_at'           => 'datetime',
        'confirmed_at'      => 'datetime',
        'provider_response' => 'object',
        'meta'              => 'object',
    ];

    public function payable()
    {
        return $this->morphTo();
    }

    public function sellRequest()
    {
        return $this->morphTo(__FUNCTION__, 'payable_type', 'payable_id')
            ->where('payable_type', SellRequest::class);
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopePaid($query)
    {
        return $query->whereIn('status', ['paid', 'confirmed']);
    }

    public function scopeExpired($query)
    {
        return $query->where('expires_at', '<', now())->where('status', 'pending');
    }

    public function isPaid(): bool
    {
        return in_array($this->status, ['paid', 'confirmed']);
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    public function isExpired(): bool
    {
        return $this->status === 'pending' && $this->expires_at && $this->expires_at->isPast();
    }
}
