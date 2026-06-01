<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FiatCurrencyGateway extends Model
{
    use HasFactory;

    protected $fillable = [
        'fiat_currency_id',
        'gateway_id',
        'fiat_send_gateway_id',
        'type',
        'name',
        'description',
        'sort_by',
        'status',
    ];

    protected $casts = [
        'status' => 'integer',
        'sort_by' => 'integer',
    ];

    public function fiatCurrency(): BelongsTo
    {
        return $this->belongsTo(FiatCurrency::class, 'fiat_currency_id');
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(Gateway::class, 'gateway_id');
    }

    public function fiatSendGateway(): BelongsTo
    {
        return $this->belongsTo(FiatSendGateway::class, 'fiat_send_gateway_id');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 1);
    }

    public function scopeForBuy($query)
    {
        return $query->where('type', 'buy');
    }

    public function scopeForSell($query)
    {
        return $query->where('type', 'sell');
    }

    public function scopeSorted($query)
    {
        return $query->orderBy('sort_by', 'ASC');
    }
}
