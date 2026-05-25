<?php

namespace App\Models;

use App\Traits\Status;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Database\Eloquent\SoftDeletes;


class ExchangeRequest extends Model
{
    use HasFactory, SoftDeletes, Status, Prunable;

    protected $fillable = ['user_id', 'send_currency_id', 'get_currency_id', 'send_amount', 'get_amount',
        'exchange_rate', 'service_fee', 'network_fee', 'final_amount', 'status', 'utr', 'deleted_at',
        'crypto_method_id', 'rate_type', 'destination_wallet', 'admin_wallet', 'expire_time',
        'quote_provider', 'quote_symbol', 'quote_reference_price', 'quote_price', 'quote_markup_percent',
        'quote_slippage_percent', 'quote_trade_fee_percent', 'quote_expires_at', 'deposit_amount_confirmed',
        'deposit_tx_id', 'deposit_confirmed_at', 'hedge_status', 'hedge_order_id', 'hedge_order_link_id', 'hedge_avg_price',
        'hedge_exec_qty', 'hedge_exec_value', 'hedge_fee_amount', 'hedge_fee_currency', 'profit_amount',
        'profit_currency', 'payout_tx_id', 'hedge_error', 'hedged_at', 'deposit_provider',
        'deposit_provider_ref', 'deposit_network', 'payout_provider', 'execution_route',
        'matched_exchange_request_id', 'execution_notes', 'routed_at', 'aml_status', 'aml_provider',
        'aml_risk_level', 'aml_risk_score', 'aml_notes', 'aml_checked_at', 'consent_record_id',
        'source_channel', 'source_metadata', 'sub_status', 'processing_deadline', 'aml_provider_reference',
        'aml_raw_response', 'confirmation_count', 'required_confirmations'];

    protected $casts = [
        'expire_time' => 'datetime',
        'quote_expires_at' => 'datetime',
        'deposit_confirmed_at' => 'datetime',
        'hedged_at' => 'datetime',
        'routed_at' => 'datetime',
        'aml_checked_at' => 'datetime',
        'source_metadata' => 'array',
        'aml_raw_response' => 'array',
        'processing_deadline' => 'datetime',
    ];

    protected $appends = ['tracking_status', 'admin_status', 'user_status'];

    public function sendCurrency()
    {
        return $this->belongsTo(CryptoCurrency::class, 'send_currency_id')->withTrashed();
    }

    public function getCurrency()
    {
        return $this->belongsTo(CryptoCurrency::class, 'get_currency_id')->withTrashed();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    public function cryptoMethod()
    {
        return $this->belongsTo(CryptoMethod::class, 'crypto_method_id');
    }

    public function payouts()
    {
        return $this->hasMany(ExchangePayout::class, 'exchange_request_id');
    }

    public function matchedExchange()
    {
        return $this->belongsTo(self::class, 'matched_exchange_request_id')->withTrashed();
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

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(2))->where('status', 0);
    }

    public function isAmlApproved(): bool
    {
        return blank($this->aml_status) || $this->aml_status === 'approved';
    }

}
