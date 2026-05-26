<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Traits\Notify;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes, Notify;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $guarded = ['id'];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $appends = ['last-seen-activity', 'fullname', 'telegram_contact'];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
        'sent_at' => 'date',
        'email_key' => 'array',
        'sms_key' => 'array',
        'push_key' => 'array',
        'in_app_key' => 'array',
        'webhook_url' => 'object'
    ];

    protected $dates = ['deleted_at'];

    protected static function boot()
    {
        parent::boot();
        static::creating(function (self $user) {
            $defaultTimezone = optional(basicControl())->time_zone ?: config('app.timezone');

            if (empty($user->attributes['timezone'] ?? null)) {
                $user->timezone = $defaultTimezone;
            }

            if (empty($user->attributes['time_zone'] ?? null)) {
                $user->time_zone = $defaultTimezone;
            }
        });
        static::saved(function () {
            Cache::forget('userRecord');
        });
        static::deleted(function () {
            Cache::forget('userRecord');
        });
        static::restored(function () {
            Cache::forget('userRecord');
        });
        static::forceDeleted(function () {
            Cache::forget('userRecord');
        });
    }


    public function funds()
    {
        return $this->hasMany(Fund::class)->latest()->where('status', '!=', 0);
    }


    public function transaction()
    {
        return $this->hasOne(Transaction::class)->latest();
    }

    public function userKycs()
    {
        return $this->hasMany(UserKyc::class)->latest();
    }


    public function getLastSeenActivityAttribute()
    {
        if (Cache::has('user-is-online-' . $this->id) == true) {
            return true;
        } else {
            return false;
        }
    }

    public function inAppNotification()
    {
        return $this->morphOne(InAppNotification::class, 'inAppNotificationable', 'in_app_notificationable_type', 'in_app_notificationable_id');
    }

    public function fireBaseToken()
    {
        return $this->morphMany(FireBaseToken::class, 'tokenable');
    }

    public function profilePicture()
    {
        $firstLetter = strtoupper(substr($this->firstname ?: $this->username ?: 'U', 0, 1));
        return '<span class="badge bg-soft-primary text-primary rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 2.25rem; height: 2.25rem;">' . e($firstLetter) . '</span>';
    }

    public function getFullNameAttribute()
    {
        return $this->firstname . ' ' . $this->lastname;
    }

    public function getPlainPhoneCode()
    {
        return str_replace('+', '', $this->phone_code);
    }

    public function getTimezoneAttribute($value)
    {
        if (!empty($value)) {
            return $value;
        }

        if (!empty($this->attributes['time_zone'] ?? null)) {
            return $this->attributes['time_zone'];
        }

        return optional(basicControl())->time_zone ?: config('app.timezone');
    }

    public function sendPasswordResetNotification($token)
    {
        $this->mail($this, 'PASSWORD_RESET', $params = [
            'message' => '<a href="' . url('password/reset', $token) . '?email=' . $this->email . '" target="_blank">Click To Reset Password</a>'
        ]);
    }

    public function getTelegramContactAttribute(): ?string
    {
        if (($this->provider ?? null) !== 'telegram' || empty($this->provider_id)) {
            return null;
        }

        $username = trim((string) ($this->username ?? ''));
        if ($username !== '' && $username !== 'tg_' . $this->provider_id && !Str::startsWith($username, 'tg_')) {
            return '@' . ltrim($username, '@');
        }

        return 'Telegram ID: ' . $this->provider_id;
    }
}
