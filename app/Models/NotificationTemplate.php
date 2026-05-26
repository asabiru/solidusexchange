<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class NotificationTemplate extends Model
{
    use HasFactory;

    protected $fillable = [
        'language_id',
        'name',
        'template_key',
        'subject',
        'email_from',
        'short_keys',
        'email',
        'sms',
        'in_app',
        'push',
        'status',
        'notify_for',
        'lang_code',
    ];

    protected $casts = [
        'short_keys' => 'array',
        'status' => 'array',
    ];

}
