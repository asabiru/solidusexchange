<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ExchangePayout extends Model
{
    use HasFactory;

    protected $fillable = [
        'exchange_request_id',
        'user_id',
        'type',
        'provider',
        'currency_code',
        'amount',
        'destination_wallet',
        'status',
        'tx_id',
        'external_reference',
        'error_message',
        'requested_at',
        'processed_at',
    ];

    protected $casts = [
        'amount' => 'float',
        'requested_at' => 'datetime',
        'processed_at' => 'datetime',
    ];

    public function exchangeRequest()
    {
        return $this->belongsTo(ExchangeRequest::class, 'exchange_request_id')->withTrashed();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }
}
