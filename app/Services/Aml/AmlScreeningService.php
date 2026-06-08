<?php

namespace App\Services\Aml;

use App\Models\AmlCheck;
use App\Services\Compliance\AuditLogService;
use Illuminate\Database\Eloquent\Model;

class AmlScreeningService
{
    public function screen(Model $checkable, array $meta = []): AmlCheck
    {
        $provider = (string) config('compliance.aml_provider', 'manual');
        $status = config('compliance.manual_aml.auto_approve_low_risk') ? 'approved' : 'pending';
        $riskLevel = $status === 'approved' ? 'low' : 'unknown';

        $check = AmlCheck::create([
            'checkable_type' => $checkable::class,
            'checkable_id' => $checkable->getKey(),
            'user_id' => $checkable->user_id ?? auth()->id(),
            'provider' => $provider,
            'status' => $status,
            'risk_level' => $riskLevel,
            'risk_categories' => $meta['risk_categories'] ?? null,
            'raw_response' => $meta['raw_response'] ?? null,
            'notes' => $status === 'approved'
                ? 'Manual AML auto-approval is enabled for low-risk flow.'
                : 'Manual AML review is required before final release.',
            'screened_at' => now(),
        ]);

        $this->syncLegacyColumns($checkable, $check);

        app(AuditLogService::class)->record('aml_screen_created', $checkable, [
            'aml_check_id' => $check->id,
            'provider' => $provider,
            'status' => $status,
            'risk_level' => $riskLevel,
        ]);

        return $check;
    }

    private function syncLegacyColumns(Model $checkable, AmlCheck $check): void
    {
        $columns = [
            'aml_status' => $check->status,
            'aml_provider' => $check->provider,
            'aml_risk_level' => $check->risk_level,
            'aml_risk_score' => $check->risk_score,
            'aml_notes' => $check->notes,
            'aml_checked_at' => $check->screened_at,
        ];

        $payload = [];
        foreach ($columns as $column => $value) {
            if ($checkable->isFillable($column) || array_key_exists($column, $checkable->getAttributes())) {
                $payload[$column] = $value;
            }
        }

        if ($payload !== []) {
            $checkable->forceFill($payload)->save();
        }
    }
}
