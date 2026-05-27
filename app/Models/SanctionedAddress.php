<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SanctionedAddress extends Model
{
    protected $fillable = [
        'address', 'currency_code', 'source', 'entity_name', 'entity_type',
        'reason', 'list_date', 'severity', 'status', 'external_id', 'meta',
    ];

    protected $casts = [
        'meta' => 'object',
    ];

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeBlocked($query)
    {
        return $query->where('severity', 'blocked')->where('status', 'active');
    }

    public function scopeHighRisk($query)
    {
        return $query->whereIn('severity', ['blocked', 'high_risk'])->where('status', 'active');
    }

    public function scopeForCurrency($query, ?string $code)
    {
        if ($code) {
            return $query->where(function ($q) use ($code) {
                $q->where('currency_code', strtoupper($code))
                  ->orWhereNull('currency_code');
            });
        }
        return $query;
    }

    public function scopeBySource($query, string $source)
    {
        return $query->where('source', $source);
    }

    /**
     * Check if an address is in the sanctions list.
     */
    public static function isSanctioned(string $address, ?string $currencyCode = null): ?self
    {
        $normalized = self::normalizeAddress($address);

        return static::active()
            ->whereIn('severity', ['blocked', 'high_risk'])
            ->where('address', $normalized)
            ->when($currencyCode, fn($q) => $q->forCurrency($currencyCode))
            ->first();
    }

    /**
     * Check if an address is flagged for monitoring.
     */
    public static function isMonitored(string $address, ?string $currencyCode = null): ?self
    {
        $normalized = self::normalizeAddress($address);

        return static::active()
            ->where('address', $normalized)
            ->when($currencyCode, fn($q) => $q->forCurrency($currencyCode))
            ->first();
    }

    /**
     * Normalize address for comparison (lowercase, trim).
     */
    public static function normalizeAddress(string $address): string
    {
        // ETH/EVM addresses: lowercase for comparison (case-insensitive per EIP-55)
        if (str_starts_with($address, '0x')) {
            return strtolower(trim($address));
        }
        // TRX addresses: Base58 is case-sensitive, but we store both cases
        // BTC bech32: lowercase per BIP 173
        if (str_starts_with($address, 'bc1') || str_starts_with($address, 'ltc1')) {
            return strtolower(trim($address));
        }
        return trim($address);
    }
}
