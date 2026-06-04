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

    protected $appends = ['image_path', 'currency_name', 'buy_method_name', 'buy_method_image_path', 'sell_method_name', 'sell_method_image_path'];

    public function getImagePathAttribute()
    {
        return getFile($this->driver, $this->image);
    }

    public function getCurrencyNameAttribute()
    {
        return $this->code . ' - ' . $this->name;
    }

    public function getBuyMethodNameAttribute(): string
    {
        return $this->formatRubMethodName($this->buyGateway?->name, 'Способ оплаты');
    }

    public function getBuyMethodImagePathAttribute(): string
    {
        if ($this->buyGateway && !empty($this->buyGateway->image)) {
            return $this->buyGateway->image_path;
        }

        return $this->methodImagePath();
    }

    public function getSellMethodNameAttribute(): string
    {
        return $this->formatRubMethodName($this->fiatSendGateway?->name, 'Способ получения');
    }

    public function getSellMethodImagePathAttribute(): string
    {
        if ($this->fiatSendGateway && !empty($this->fiatSendGateway->image)) {
            return $this->fiatSendGateway->image_path;
        }

        return $this->methodImagePath();
    }

    private function formatRubMethodName(?string $name, string $fallback): string
    {
        $name = trim((string) $name);

        if ($name === '' || $this->isGenericRubLabel($name)) {
            return strtoupper((string) $this->code) === 'RUB' ? $fallback : $this->name;
        }

        $name = preg_replace('/\s+—\s*Russian Ruble$/iu', '', $name) ?: $name;
        $name = preg_replace('/\s+-\s*Russian Ruble$/iu', '', $name) ?: $name;

        $name = trim($name);

        return $this->isGenericRubLabel($name) ? $fallback : $name;
    }

    private function methodImagePath(): string
    {
        if (empty($this->image) || $this->isGenericRubLabel($this->name)) {
            return '';
        }

        return $this->image_path;
    }

    private function isGenericRubLabel(?string $name): bool
    {
        $name = trim((string) $name);

        if ($name === '') {
            return true;
        }

        $normalized = preg_replace('/[\s_\-—]+/u', ' ', $name) ?: $name;

        return (bool) preg_match('/^(rub|rur|russian r[ou]ble|рубл[ьиь]|российский рубл[ьиь]|оплата рублями|получение рубл[её]й)$/iu', trim($normalized));
    }

    public function fiatSendGateway()
    {
        return $this->belongsTo(FiatSendGateway::class, 'fiat_send_gateway_id');
    }

    public function buyGateway()
    {
        return $this->belongsTo(Gateway::class, 'buy_gateway_id');
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
