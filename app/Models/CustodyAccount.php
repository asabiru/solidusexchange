<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodyAccount extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'available_balance' => 'decimal:8',
        'reserved_balance' => 'decimal:8',
    ];

    public function user()
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
