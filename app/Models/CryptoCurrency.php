<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class CryptoCurrency extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['name', 'code', 'symbol', 'rate', 'usd_rate', 'change_24h', 'sparkline_7d', 'service_fee', 'service_fee_type', 'network_fee', 'network_fee_type', 'buy_margin_percent', 'sell_margin_percent', 'exchange_margin_percent', 'min_send', 'max_send', 'image', 'driver', 'status', 'show_on_homepage', 'show_in_reserves', 'reserve_amount', 'sort_by', 'is_stablecoin', 'last_rate_sync_at', 'last_rate_sync_error'];
    protected $casts = [
        'last_rate_sync_at' => 'datetime',
        'is_stablecoin' => 'boolean',
        'show_on_homepage' => 'boolean',
        'show_in_reserves' => 'boolean',
        'reserve_amount' => 'decimal:8',
        'change_24h' => 'double',
        'sparkline_7d' => 'array',
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

    public function getNormalizedCodeAttribute(): string
    {
        $code = strtoupper((string) $this->code);
        return str_contains($code, '_') ? explode('_', $code)[0] : $code;
    }
}
