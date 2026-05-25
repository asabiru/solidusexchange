<?php

namespace App\Services\Compliance;

use App\Models\ConsentRecord;
use App\Models\LegalDocument;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ConsentService
{
    public function record(Request $request, Model $consentable, string $consentType = 'trade_terms'): ConsentRecord
    {
        $document = LegalDocument::current($consentType)
            ?? LegalDocument::current('terms_of_service')
            ?? $this->fallbackDocument($consentType);

        $record = ConsentRecord::create([
            'user_id' => auth()->id(),
            'consentable_type' => $consentable::class,
            'consentable_id' => $consentable->getKey(),
            'consent_type' => $consentType,
            'legal_document_id' => $document?->id,
            'document_version' => $document?->version ?? config('compliance.default_consent_version', '2026-05-25'),
            'document_hash' => $document?->hash ?? hash('sha256', config('app.name') . ':' . $consentType),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'metadata' => [
                'source_channel' => $this->sourceChannel($request),
                'role' => 'marketplace_intermediary',
            ],
            'accepted_at' => now(),
        ]);

        if ($consentable->isFillable('consent_record_id') || array_key_exists('consent_record_id', $consentable->getAttributes())) {
            $consentable->forceFill(['consent_record_id' => $record->id])->save();
        }

        app(AuditLogService::class)->record('consent_given', $consentable, [
            'consent_record_id' => $record->id,
            'consent_type' => $consentType,
            'document_version' => $record->document_version,
        ], [], [], $request);

        return $record;
    }

    public function sourceChannel(Request $request): string
    {
        if ($request->filled('source_channel')) {
            return Str::limit((string) $request->input('source_channel'), 40, '');
        }

        if ($request->headers->has('X-Telegram-Init-Data') || $request->filled('telegram_init_data')) {
            return 'telegram_mini_app';
        }

        return 'web';
    }

    private function fallbackDocument(string $consentType): ?LegalDocument
    {
        return new LegalDocument([
            'type' => $consentType,
            'version' => config('compliance.default_consent_version', '2026-05-25'),
            'locale' => app()->getLocale(),
            'title' => 'SolidChange trade terms',
            'hash' => hash('sha256', config('app.name') . ':' . $consentType),
        ]);
    }
}
