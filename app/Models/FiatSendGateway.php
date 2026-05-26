<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FiatSendGateway extends Model
{
    use HasFactory;

    protected $guarded = ['id'];
    protected $casts = [
        'parameters' => 'object',
        'supported_currency' => 'array'
    ];

    protected $appends = ['image_path'];

    public function getImagePathAttribute()
    {
        return getFile($this->driver, $this->image);
    }

    public function getIsManualAttribute(): bool
    {
        return ($this->processing_mode ?? 'manual') === 'manual';
    }

    public function getIsAutomaticAttribute(): bool
    {
        return !$this->is_manual;
    }
}
