<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ExchangeWallet extends Model
{
    use HasFactory;

    protected $fillable = [
        'currency_code',
        'address',
        'network',
        'label',
        'notes',
        'status',
        'allocation_status',
        'watch_provider',
        'watch_status',
        'watch_reference',
        'webhook_subscribed_at',
        'watch_error',
        'exchange_request_id',
        'reserved_at',
        'consumed_at',
    ];

    protected $casts = [
        'status' => 'boolean',
        'webhook_subscribed_at' => 'datetime',
        'reserved_at' => 'datetime',
        'consumed_at' => 'datetime',
    ];

    public function exchangeRequest()
    {
        return $this->belongsTo(ExchangeRequest::class, 'exchange_request_id');
    }

    public function scopeForCurrency($query, string $currencyCode)
    {
        return $query->where('currency_code', strtoupper(trim($currencyCode)));
    }

    public function scopeAvailable($query)
    {
        return $query->where('status', true)->where('allocation_status', 'available');
    }
}
