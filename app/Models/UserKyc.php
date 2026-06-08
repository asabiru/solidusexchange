<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UserKyc extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'kyc_info' => 'object',
        'provider_payload' => 'array',
        'provider_completed_at' => 'datetime',
    ];

    public function scopeOwn($query)
    {
        return $query->where('user_id', auth()->id());
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function getStatus($type = null)
    {
        if ($this->status == 0) {
            return !$type ? '<span class="badge text-bg-dark">' . trans('Pending') . '</span>' : trans('Pending');
        } elseif ($this->status == 1) {
            return !$type ? '<span class="badge text-bg-primary">' . trans('Verified') . '</span>' : trans('Verified');
        } else {
            return !$type ? '<span class="badge text-bg-danger">' . trans('Rejected') . '</span>' : trans('Rejected');
        }
    }

    public function kycInfoShow()
    {
        $kycInfo = [];
        foreach ((array) $this->kyc_info as $info) {
            if ($info->type == 'file') {
                $kycInfo[] = [
                    'name' => stringToTitle($info->field_name),
                    'value' => getFile($info->field_driver, $info->field_value),
                    'type' => $info->type
                ];
            } else {
                $kycInfo[] = [
                    'name' => stringToTitle($info->field_name),
                    'value' => $info->field_value,
                    'type' => $info->type
                ];
            }
        }

        if (count($kycInfo) === 0 && in_array($this->provider, ['sumsub', 'didit'], true)) {
            $kycInfo[] = [
                'name' => 'Provider',
                'value' => $this->provider === 'didit' ? 'Didit' : 'Sumsub',
                'type' => 'text',
            ];
            if (!empty($this->provider_applicant_id)) {
                $kycInfo[] = [
                    'name' => $this->provider === 'didit' ? 'Session ID' : 'Applicant ID',
                    'value' => $this->provider_applicant_id,
                    'type' => 'text',
                ];
            }
            if (!empty($this->provider_review_status)) {
                $kycInfo[] = [
                    'name' => 'Review Status',
                    'value' => $this->provider_review_status,
                    'type' => 'text',
                ];
            }
            if (!empty($this->provider_review_answer)) {
                $kycInfo[] = [
                    'name' => 'Review Result',
                    'value' => $this->provider_review_answer,
                    'type' => 'text',
                ];
            }
            if (!empty($this->reason)) {
                $kycInfo[] = [
                    'name' => 'Reason',
                    'value' => $this->reason,
                    'type' => 'textarea',
                ];
            }
        }

        return $kycInfo;
    }
}
