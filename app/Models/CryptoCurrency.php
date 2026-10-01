<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class CryptoCurrency extends Model
{
    use HasFactory, SoftDeletes;

    private const CANONICAL_ICON_FILES = [
        'BTC' => 'btc.svg',
        'ETH' => 'eth.svg',
        'ETH_ARB' => 'eth-arb.svg',
        'ETH_BASE' => 'eth-base.svg',
        'ETH_OPT' => 'eth-opt.svg',
        'BNB' => 'bnb.svg',
        'LTC' => 'ltc.svg',
        'SOL' => 'sol.svg',
        'TON' => 'ton.svg',
        'TRX' => 'trx.svg',
        'USDC_ARB' => 'usdc-arb.svg',
        'USDC_BASE' => 'usdc-base.svg',
        'USDC_BSC' => 'usdc-bsc.svg',
        'USDC_ERC20' => 'usdc-erc20.svg',
        'USDC_OPT' => 'usdc-opt.svg',
        'USDC_SOL' => 'usdc-sol.svg',
        'USDT_ARB' => 'usdt-arb.svg',
        'USDT_BSC' => 'usdt-bsc.svg',
        'USDT_ERC20' => 'usdt-erc20.svg',
        'USDT_OPT' => 'usdt-opt.svg',
        'USDT_SOL' => 'usdt-sol.svg',
        'USDT_TON' => 'usdt-ton.svg',
        'USDT_TRC20' => 'usdt-trc20.svg',
    ];

    protected $fillable = ['name', 'code', 'symbol', 'rate', 'usd_rate', 'service_fee', 'service_fee_type', 'network_fee', 'network_fee_type', 'min_send', 'max_send', 'image', 'driver', 'status', 'sort_by', 'is_stablecoin', 'last_rate_sync_at', 'last_rate_sync_error'];
    protected $casts = [
        'last_rate_sync_at' => 'datetime',
        'is_stablecoin' => 'boolean',
    ];
    protected $appends = ['image_path', 'currency_name'];

    public function getImagePathAttribute()
    {
        if ($canonicalIcon = $this->canonicalIconPath()) {
            return asset($canonicalIcon) . '?v=' . $this->canonicalIconVersion($canonicalIcon);
        }

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

    public function canonicalIconPath(): ?string
    {
        $file = self::CANONICAL_ICON_FILES[strtoupper((string) $this->code)] ?? null;

        return $file ? 'assets/upload/cryptoCurrency/' . $file : null;
    }

    private function canonicalIconVersion(string $path): string
    {
        $configuredVersion = (string) (config('app.asset_version') ?? env('APP_VERSION', ''));

        if ($configuredVersion !== '') {
            return $configuredVersion;
        }

        $absolutePath = public_path($path);

        return file_exists($absolutePath) ? (string) filemtime($absolutePath) : '1';
    }
}
