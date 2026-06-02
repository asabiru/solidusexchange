<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TelegramBot extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'bot_token',
        'webhook_url',
        'type',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function chats()
    {
        return $this->hasMany(TelegramBotChat::class);
    }
}
