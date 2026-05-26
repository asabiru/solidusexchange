<?php

namespace App\Models;

use App\Traits\TimeZone;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Transaction extends Model
{
    use HasFactory, TimeZone;

    protected $fillable = ['transactional_id', 'transactional_type', 'user_id', 'amount', 'balance', 'charge', 'trx_type', 'remarks', 'trx_id'];

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function transactional()
    {
        return $this->morphTo();
    }

    public function getCreatedAtAttribute($value)
    {
        return $this->localDateFormat($value);
    }
}
