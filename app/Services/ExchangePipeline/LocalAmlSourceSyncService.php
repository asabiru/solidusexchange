<?php

namespace App\Services\ExchangePipeline;

use App\Models\SanctionedAddress;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class LocalAmlSourceSyncService
{
    public function sync(?string $path = null, bool $pruneMissing = false): array
    {
        $directory = $this->resolveDirectory($path);
        $summary = [
            'directory' => $directory,
            'files' => 0,
            'imported' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'revoked' => 0,
            'skipped' => 0,
        ];

        if (!is_dir($directory)) {
            return $summary;
        }

        if (!Schema::hasTable('sanctioned_addresses')) {
            throw new \RuntimeException('AML tables are missing. Run php artisan migrate before syncing local AML sources.');
        }

        $processedAddressesBySource = [];
        $files = collect(File::files($directory))
            ->filter(fn ($file) => in_array(strtolower($file->getExtension()), ['json', 'csv'], true))
            ->sortBy(fn ($file) => $file->getFilename())
            ->values();

        foreach ($files as $file) {
            $summary['files']++;

            $parsedFile = $this->parseFileData($file->getPathname());

            foreach ($parsedFile['sources'] as $source) {
                if (!is_string($source) || $source === '') {
                    continue;
                }

                $processedAddressesBySource[$source] ??= [];
            }

            foreach ($parsedFile['entries'] as $entry) {
                $payload = $this->normalizeEntry($entry, $file->getFilename());
                if (!$payload) {
                    $summary['skipped']++;
                    continue;
                }

                $processedAddressesBySource[$payload['source']][$payload['address']] = true;

                $model = SanctionedAddress::firstOrNew([
                    'address' => $payload['address'],
                    'source' => $payload['source'],
                ]);

                $wasExisting = $model->exists;
                $model->fill($payload);

                if (!$wasExisting) {
                    $model->save();
                    $summary['imported']++;
                    continue;
                }

                if ($model->isDirty()) {
                    $model->save();
                    $summary['updated']++;
                    continue;
                }

                $summary['unchanged']++;
            }
        }

        if ($pruneMissing) {
            foreach ($processedAddressesBySource as $source => $addresses) {
                $summary['revoked'] += SanctionedAddress::query()
                    ->where('source', $source)
                    ->where('status', 'active')
                    ->whereNotIn('address', array_keys($addresses))
                    ->update(['status' => 'revoked']);
            }
        }

        return $summary;
    }

    private function resolveDirectory(?string $path = null): string
    {
        $configured = trim((string) ($path ?: config('exchange_pipeline.aml.local_sources_path')));

        if ($configured === '') {
            return database_path('data/aml_sources');
        }

        return str_starts_with($configured, DIRECTORY_SEPARATOR) || preg_match('/^[A-Za-z]:[\\\\\\/]/', $configured)
            ? $configured
            : base_path($configured);
    }

    private function parseFileData(string $path): array
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'json' => $this->parseJsonFileData($path),
            'csv' => $this->parseCsvFileData($path),
            default => ['entries' => [], 'sources' => []],
        };
    }

    private function parseJsonFileData(string $path): array
    {
        $decoded = json_decode($this->stripUtf8Bom((string) File::get($path)), true);
        if (!is_array($decoded)) {
            return ['entries' => [], 'sources' => []];
        }

        if (array_is_list($decoded)) {
            $defaultSource = $this->normalizeSource(pathinfo($path, PATHINFO_FILENAME));
            $sources = [];

            foreach ($decoded as $entry) {
                if (!is_array($entry)) {
                    continue;
                }

                $source = trim((string) ($entry['source'] ?? ''));
                $sources[$source !== '' ? $this->normalizeSource($source) : $defaultSource] = true;
            }

            if ($sources === []) {
                $sources[$defaultSource] = true;
            }

            return ['entries' => $decoded, 'sources' => array_keys($sources)];
        }

        $defaults = $decoded;
        $entries = $defaults['entries'] ?? [];
        $sources = [$this->normalizeSource((string) ($defaults['source'] ?? pathinfo($path, PATHINFO_FILENAME)))];
        unset($defaults['entries']);

        if (!is_array($entries)) {
            return ['entries' => [], 'sources' => $sources];
        }

        return [
            'entries' => array_map(function ($entry) use ($defaults) {
                return is_array($entry) ? array_merge($defaults, $entry) : [];
            }, $entries),
            'sources' => $sources,
        ];
    }

    private function parseCsvFileData(string $path): array
    {
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false || $lines === []) {
            return [
                'entries' => [],
                'sources' => [$this->normalizeSource(pathinfo($path, PATHINFO_FILENAME))],
            ];
        }

        $header = null;
        $entries = [];
        $sources = [];
        $defaultSource = $this->normalizeSource(pathinfo($path, PATHINFO_FILENAME));

        foreach ($lines as $line) {
            $row = str_getcsv($line);
            if ($header === null) {
                $header = array_map(fn ($value) => $this->normalizeHeaderValue($value), $row);
                continue;
            }

            if ($row === [null] || $row === []) {
                continue;
            }

            $entry = array_combine($header, array_pad($row, count($header), null)) ?: [];
            $entries[] = $entry;

            $source = trim((string) ($entry['source'] ?? ''));
            $sources[$source !== '' ? $this->normalizeSource($source) : $defaultSource] = true;
        }

        if ($entries === []) {
            $sources[$defaultSource] = true;
        }

        return [
            'entries' => $entries,
            'sources' => array_keys($sources),
        ];
    }

    private function normalizeEntry(array $entry, string $filename): ?array
    {
        $address = trim((string) ($entry['address'] ?? ''));
        if ($address === '') {
            return null;
        }

        $source = $this->normalizeSource((string) ($entry['source'] ?? pathinfo($filename, PATHINFO_FILENAME)));
        $severity = $this->normalizeSeverity((string) ($entry['severity'] ?? 'blocked'));
        $status = $this->normalizeStatus((string) ($entry['status'] ?? 'active'));
        $currencyCode = trim((string) ($entry['currency_code'] ?? ''));
        $tags = $this->normalizeTags($entry['tags'] ?? null);
        $meta = is_array($entry['meta'] ?? null) ? $entry['meta'] : [];

        if ($tags !== []) {
            $meta['tags'] = $tags;
        }

        $meta['imported_from'] = $filename;

        return [
            'address' => SanctionedAddress::normalizeAddress($address),
            'currency_code' => $currencyCode !== '' ? strtoupper($currencyCode) : null,
            'source' => $source,
            'entity_name' => $this->nullableTrim($entry['entity_name'] ?? null),
            'entity_type' => $this->nullableTrim($entry['entity_type'] ?? null),
            'reason' => $this->nullableTrim($entry['reason'] ?? null),
            'list_date' => $this->nullableTrim($entry['list_date'] ?? null),
            'severity' => $severity,
            'status' => $status,
            'external_id' => $this->nullableTrim($entry['external_id'] ?? null),
            'meta' => $meta === [] ? null : $meta,
        ];
    }

    private function normalizeSource(string $source): string
    {
        $normalized = Str::snake(trim($source));

        return $normalized !== '' ? $normalized : 'local_import';
    }

    private function normalizeSeverity(string $severity): string
    {
        return match (Str::lower(trim($severity))) {
            'blocked' => 'blocked',
            'high_risk' => 'high_risk',
            'monitor' => 'monitor',
            default => 'high_risk',
        };
    }

    private function normalizeStatus(string $status): string
    {
        return match (Str::lower(trim($status))) {
            'active' => 'active',
            'expired' => 'expired',
            'revoked' => 'revoked',
            default => 'active',
        };
    }

    private function normalizeTags($tags): array
    {
        if (is_string($tags)) {
            $tags = preg_split('/[|,;]+/', $tags);
        }

        if (!is_array($tags)) {
            return [];
        }

        return array_values(array_filter(array_map(function ($tag) {
            $value = trim((string) $tag);

            return $value !== '' ? Str::snake($value) : null;
        }, $tags)));
    }

    private function nullableTrim($value): ?string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private function normalizeHeaderValue($value): string
    {
        return trim($this->stripUtf8Bom((string) $value));
    }

    private function stripUtf8Bom(string $value): string
    {
        return preg_replace('/^\xEF\xBB\xBF/', '', $value) ?? $value;
    }
}
