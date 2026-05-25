<?php

namespace App\Models;

use App\Traits\Status;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Database\Eloquent\SoftDeletes;

class SellRequest extends Model
{
    use HasFactory, SoftDeletes, Status, Prunable;

    protected $guarded = ['id'];
    protected $casts = [
        'parameters' => 'object',
        'p2p_counterparty_info' => 'array',
        'client_fiat_confirmed' => 'boolean',
        'assigned_at' => 'datetime',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'processing_deadline' => 'datetime',
        'fiat_sent_at' => 'datetime',
        'crypto_confirmed_at' => 'datetime',
        'client_confirm_deadline' => 'datetime',
        'aml_checked_at' => 'datetime',
    ];

    public function sendCurrency()
    {
        return $this->belongsTo(CryptoCurrency::class, 'send_currency_id')->withTrashed();
    }

    public function getCurrency()
    {
        return $this->belongsTo(FiatCurrency::class, 'get_currency_id')->withTrashed();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    public function fiatSendGateway()
    {
        return $this->belongsTo(FiatSendGateway::class, 'fiat_send_gateway_id');
    }

    public function cryptoMethod()
    {
        return $this->belongsTo(CryptoMethod::class, 'crypto_method_id');
    }

    public function assignedTrader()
    {
        return $this->belongsTo(Admin::class, 'assigned_trader_id');
    }

    public function completedByTrader()
    {
        return $this->belongsTo(Admin::class, 'completed_by_trader_id');
    }

    public function cancelledByTrader()
    {
        return $this->belongsTo(Admin::class, 'cancelled_by_trader_id');
    }

    public function consentRecord()
    {
        return $this->belongsTo(ConsentRecord::class);
    }

    public function proofs()
    {
        return $this->morphMany(DealProof::class, 'proofable');
    }

    public function notes()
    {
        return $this->morphMany(DealNote::class, 'notable');
    }

    public function disputes()
    {
        return $this->morphMany(Dispute::class, 'disputable');
    }

    public function amlChecks()
    {
        return $this->morphMany(AmlCheck::class, 'checkable');
    }

    public function scopeManual(Builder $query): Builder
    {
        return $query->whereHas('fiatSendGateway', function (Builder $builder) {
            $builder->where('processing_mode', 'manual');
        });
    }

    public function isManualProcessing(): bool
    {
        return optional($this->fiatSendGateway)->processing_mode === 'manual';
    }

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(2))->where('status', 0);
    }
}
