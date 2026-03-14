<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CoinAnnounce extends Model
{
    use HasFactory;

    protected $fillable = ['heading', 'description', 'image', 'driver', 'status'];
}
