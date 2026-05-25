<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AmlCheck extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'risk_categories' => 'array',
        'raw_response' => 'array',
        'screened_at' => 'datetime',
    ];

    public function checkable()
    {
        return $this->morphTo();
    }
}
