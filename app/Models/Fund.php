<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Fund extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'gateway_id', 'fundable_id', 'fundable_type', 'gateway_currency', 'amount', 'charge', 'percentage_charge',
        'fixed_charge', 'final_amount', 'payable_amount_base_currency', 'btc_amount', 'btc_wallet', 'transaction', 'status', 'detail', 'feedback', 'validation_token',
        'referenceno', 'reason', 'information', 'api_response'];

    protected $table = "funds";

    protected $casts = [
        'detail' => 'object',
        'information' => 'object'
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function gateway()
    {
        return $this->belongsTo(Gateway::class, 'gateway_id');
    }

    public function getStatusClass()
    {
        return [
            '1' => 'text-success',
            '2' => 'text-pending',
            '3' => 'text-danger',
            '4' => 'text-danger',
        ][$this->status] ?? 'text-danger';
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

    public function transactional()
    {
        return $this->morphOne(Transaction::class, 'transactional');
    }

}
