<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FiatCurrency extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['name', 'code', 'symbol', 'rate', 'usd_rate', 'rate_markup_percent', 'processing_fee', 'processing_fee_type', 'min_send', 'max_send', 'image', 'driver', 'status', 'show_in_buy', 'show_in_sell', 'buy_gateway_id', 'fiat_send_gateway_id', 'sort_by', 'last_rate_sync_at', 'last_rate_sync_error'];
    protected $casts = [
        'last_rate_sync_at' => 'datetime',
        'rate_markup_percent' => 'float',
        'show_in_buy' => 'boolean',
        'show_in_sell' => 'boolean',
        'buy_gateway_id' => 'integer',
        'fiat_send_gateway_id' => 'integer',
    ];

    protected $appends = ['image_path', 'currency_name'];

    public function getImagePathAttribute()
    {
        return getFile($this->driver, $this->image);
    }

    public function getCurrencyNameAttribute()
    {
        return $this->code . ' - ' . $this->name;
    }

    public function fiatSendGateway()
    {
        return $this->belongsTo(FiatSendGateway::class, 'fiat_send_gateway_id');
    }

    public function buyGateway()
    {
        return $this->belongsTo(Gateway::class, 'buy_gateway_id');
    }

    public function buyGateways()
    {
        return $this->hasMany(FiatCurrencyGateway::class, 'fiat_currency_id')
            ->forBuy()
            ->active()
            ->sorted()
            ->with('gateway');
    }

    public function sellGateways()
    {
        return $this->hasMany(FiatCurrencyGateway::class, 'fiat_currency_id')
            ->forSell()
            ->active()
            ->sorted()
            ->with('fiatSendGateway');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 1);
    }

    public function scopeVisibleInBuy($query)
    {
        return $query->where('show_in_buy', 1);
    }

    public function scopeVisibleInSell($query)
    {
        return $query->where('show_in_sell', 1);
    }

    public function scopeSorted($query)
    {
        return $query->orderBy('sort_by', 'ASC');
    }

    public function resolveRateMarkupFactor(): float
    {
        return 1 + (max(0, (float) $this->rate_markup_percent) / 100);
    }

    public function applyRateMarkupToUsdRate(float $usdRate): float
    {
        if ($usdRate <= 0) {
            return $usdRate;
        }

        return $usdRate / $this->resolveRateMarkupFactor();
    }
}
