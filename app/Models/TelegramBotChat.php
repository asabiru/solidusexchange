<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TelegramBotChat extends Model
{
    use HasFactory;

    protected $fillable = [
        'telegram_bot_id',
        'chat_id',
        'chatable_id',
        'chatable_type',
        'username',
        'first_name',
        'last_name',
    ];

    public function bot()
    {
        return $this->belongsTo(TelegramBot::class, 'telegram_bot_id');
    }

    public function chatable()
    {
        return $this->morphTo();
    }
}
