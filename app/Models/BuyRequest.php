<?php

namespace App\Models;

use App\Traits\Status;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Database\Eloquent\SoftDeletes;

class BuyRequest extends Model
{
    use HasFactory, SoftDeletes, Status, Prunable;

    protected $guarded = ['id'];
    protected $appends = ['show_exchange_rate', 'tracking_status', 'admin_status'];

    public function sendCurrency()
    {
        return $this->belongsTo(FiatCurrency::class, 'send_currency_id')->withTrashed();
    }

    public function getCurrency()
    {
        return $this->belongsTo(CryptoCurrency::class, 'get_currency_id')->withTrashed();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    public function gateway()
    {
        return $this->belongsTo(Gateway::class, 'gateway_id');
    }

    public function deposit()
    {
        return $this->morphOne(Deposit::class, 'depositable')->latest();
    }

    public function getShowExchangeRateAttribute()
    {
        if ($this->exchange_rate) {
            return number_format(1 / $this->exchange_rate, 2);
        }
    }

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(2))->where('status', 0);
    }
}
