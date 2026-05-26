<?php

namespace App\Models;

use App\Traits\TimeZone;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class SupportTicket extends Model
{
    use HasFactory, TimeZone;

    protected $guarded = ['id'];

    protected $dates = ['last_reply'];

    public function scopeOwn($query)
    {
        return $query->where('user_id', auth()->id());
    }

    public function getUsernameAttribute()
    {
        return $this->name;
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function messages()
    {
        return $this->hasMany(SupportTicketMessage::class)->latest();
    }

    public function lastReply()
    {
        return $this->hasOne(SupportTicketMessage::class)->latest();
    }

    public function getLastMessageAttribute()
    {
        return Str::limit($this->lastReply->message, 40);
    }

    public function getStatus($type = null)
    {
        if ($this->status == 0) {
            return !$type ? '<span class="badge text-bg-success">Open</span>' : 'Open';
        } elseif ($this->status == 1) {
            return !$type ? '<span class="badge text-bg-primary">Answered</span>' : 'Answered';
        } elseif ($this->status == 2) {
            return !$type ? '<span class="badge text-bg-warning">Replied</span>' : 'Replied';
        } else {
            return !$type ? '<span class="badge text-bg-danger">Closed</span>' : 'Closed';
        }
    }

    public function getLastReplyAttribute($value)
    {
        return $this->localDateFormat($value);
    }

}
