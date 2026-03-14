<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class CryptoCurrency extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['name', 'code', 'symbol', 'rate', 'usd_rate', 'service_fee', 'service_fee_type', 'network_fee', 'network_fee_type', 'min_send', 'max_send', 'image', 'driver', 'status', 'sort_by'];
    protected $casts = [
        'last_rate_sync_at' => 'datetime',
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
}
