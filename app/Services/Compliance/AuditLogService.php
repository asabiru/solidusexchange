<?php

namespace App\Services\Compliance;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class AuditLogService
{
    public function record(string $action, ?Model $auditable = null, array $newValues = [], array $oldValues = [], array $metadata = [], ?Request $request = null): AuditLog
    {
        $request ??= request();

        return AuditLog::create([
            'auditable_type' => $auditable ? $auditable::class : null,
            'auditable_id' => $auditable?->getKey(),
            'user_id' => auth()->id(),
            'admin_id' => auth('admin')->id(),
            'action' => $action,
            'old_values' => $oldValues ?: null,
            'new_values' => $newValues ?: null,
            'metadata' => $metadata ?: null,
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
            'idempotency_key' => $metadata['idempotency_key'] ?? null,
        ]);
    }
}
