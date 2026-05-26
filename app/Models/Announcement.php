<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Announcement extends Model
{
    use HasFactory;

    protected $fillable = ['announcement_text', 'btn_name', 'btn_link', 'btn_display', 'status'];

    protected static function boot()
    {
        parent::boot();
        static::saved(function () {
            \Cache::forget('announcement');
        });
    }
}
