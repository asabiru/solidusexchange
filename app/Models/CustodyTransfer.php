<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustodyTransfer extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'amount' => 'decimal:8',
        'metadata' => 'array',
    ];

    public function transferable()
    {
        return $this->morphTo();
    }
}
