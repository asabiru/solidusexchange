<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DealProof extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    public function proofable()
    {
        return $this->morphTo();
    }
}
