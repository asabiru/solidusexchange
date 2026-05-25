<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TraderPaymentAccount extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'is_active' => 'boolean',
        'daily_limit' => 'decimal:8',
        'current_daily_used' => 'decimal:8',
    ];

    public function admin()
    {
        return $this->belongsTo(Admin::class);
    }
}
