<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AmlScreeningLog extends Model
{
    protected $fillable = [
        'screenable_type', 'screenable_id', 'address', 'currency_code',
        'provider', 'result', 'matched_entity', 'matched_source',
        'risk_score', 'details', 'checked_at',
    ];

    protected $casts = [
        'checked_at' => 'datetime',
        'risk_score' => 'decimal:2',
    ];

    public function screenable()
    {
        return $this->morphTo();
    }

    public function scopeMatches($query)
    {
        return $query->whereIn('result', ['match', 'partial_match']);
    }

    public function scopeClean($query)
    {
        return $query->where('result', 'clean');
    }
}
