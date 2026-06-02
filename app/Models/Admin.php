<?php

namespace App\Models;

use App\Models\SellRequest;
use App\Traits\Notify;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\HasApiTokens;

class Admin extends Authenticatable
{
    use HasFactory, Notifiable, HasApiTokens, Notify;

    protected $fillable = [
        'name',
        'username',
        'email',
        'password',
        'two_fa',
        'two_fa_verify',
        'two_fa_code',
        'image',
        'image_driver',
        'phone',
        'telegram_username',
        'address',
        'admin_access',
        'last_login',
        'status',
        'is_trade_online',
        'role',
        'last_seen',
        'remember_token',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        'verification_token'
    ];

    protected $casts = [
        'is_trade_online' => 'boolean',
        'last_seen' => 'datetime',
    ];

    public function fireBaseToken()
    {
        return $this->morphMany(FireBaseToken::class, 'tokenable');
    }

    public function inAppNotification()
    {
        return $this->morphOne(InAppNotification::class, 'inAppNotificationable', 'in_app_notificationable_type', 'in_app_notificationable_id');
    }

    public function sendPasswordResetNotification($token)
    {
        $this->mail($this, 'PASSWORD_RESET', $params = [
            'message' => '<a href="' . url('admin/password/reset', $token) . '?email=' . $this->email . '" target="_blank">Click To Reset Password</a>'
        ]);
    }

    public function profilePicture()
    {
        $disk = $this->image_driver;
        $image = $this->image ?? 'unknown';

        try {
            if ($disk == 'local') {
                $localImage = asset('/assets/upload') . '/' . $image;
                return \Illuminate\Support\Facades\Storage::disk($disk)->exists($image) ? $localImage : asset(config('location.default'));
            } else {
                return \Illuminate\Support\Facades\Storage::disk($disk)->exists($image) ? \Illuminate\Support\Facades\Storage::disk($disk)->url($image) : asset(config('filelocation.default'));
            }
        } catch (\Exception $e) {
            return asset(config('location.default'));
        }
    }

    public function assignedSellRequests()
    {
        return $this->hasMany(SellRequest::class, 'assigned_trader_id');
    }

    public function completedSellRequests()
    {
        return $this->hasMany(SellRequest::class, 'completed_by_trader_id');
    }

    public function cancelledSellRequests()
    {
        return $this->hasMany(SellRequest::class, 'cancelled_by_trader_id');
    }

    public function isTrader(): bool
    {
        return ($this->role ?? 'admin') === 'trader';
    }

    public function isSupport(): bool
    {
        return ($this->role ?? 'admin') === 'support';
    }

    public function isAdmin(): bool
    {
        return ($this->role ?? 'admin') === 'admin';
    }

    public function hasRecentSession(): bool
    {
        return Cache::has('admin-is-online-' . $this->id)
            || ($this->last_seen && $this->last_seen->greaterThanOrEqualTo(now()->subMinutes(2)));
    }

    public function canReceiveManualDeals(): bool
    {
        return $this->isTrader()
            && (int) $this->status === 1
            && $this->is_trade_online
            && $this->hasRecentSession();
    }

    public function getTelegramDisplayAttribute(): ?string
    {
        if (empty($this->telegram_username)) {
            return null;
        }

        return '@' . ltrim($this->telegram_username, '@');
    }

}
