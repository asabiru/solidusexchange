<?php

namespace App\Models;


use App\Traits\TimeZone;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Support\Facades\Cache;

class Deposit extends Model
{
    use HasFactory, TimeZone, Prunable;

    protected $fillable = ['depositable_id', 'depositable_type', 'user_id', 'payment_method_id', 'payment_method_currency', 'amount', 'charge_percentage',
        'charge_fixed', 'payable_amount', 'payable_amount_base_currency', 'btc_amount', 'btc_wallet', 'information', 'trx_id', 'status', 'note'];


    protected $casts = [
        'information' => 'object'
    ];

    public function transactional()
    {
        return $this->morphOne(Transaction::class, 'transactional');
    }

    public function depositable()
    {
        return $this->morphTo();
    }

    protected static function boot()
    {
        parent::boot();
        static::saved(function () {
            Cache::forget('paymentRecord');
        });
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function gateway()
    {
        return $this->belongsTo(Gateway::class, 'payment_method_id', 'id');
    }

    public function picture()
    {
        $image = optional($this->gateway)->image;
        if (!$image) {
            $firstLetter = substr(optional($this->gateway)->name, 0, 1);
            return '<div class="avatar avatar-sm avatar-soft-primary avatar-circle">
                        <span class="avatar-initials">' . $firstLetter . '</span>
                     </div>';

        } else {
            $url = getFile(optional($this->gateway)->driver, optional($this->gateway)->image);
            return '<div class="avatar avatar-sm avatar-circle">
                        <img class="avatar-img" src="' . $url . '" alt="Image Description">
                     </div>';

        }
    }

    public function getStatusClass()
    {
        return [
                '0' => 'text-dark',
                '1' => 'text-success',
                '2' => 'text-dark',
                '3' => 'text-danger',
            ][$this->status] ?? 'text-danger';
    }

    public function getCreatedAtAttribute($value)
    {
        return $this->localDateFormat($value);
    }

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(2))->where('status', 0);
    }
}
