<?php

namespace App\Services\ExchangePipeline;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class LocalAmlFeedRefreshService
{
    public function refresh(?string $manifestPath = null, ?string $sourcesPath = null): array
    {
        $manifestFile = $this->resolveManifestPath($manifestPath);
        $targetDirectory = $this->resolveSourcesDirectory($sourcesPath);
        $summary = [
            'manifest' => $manifestFile,
            'directory' => $targetDirectory,
            'feeds' => 0,
            'downloaded' => 0,
            'written_files' => 0,
            'entries' => 0,
            'skipped' => 0,
            'errors' => [],
        ];

        if (!is_file($manifestFile)) {
            return $summary;
        }

        $feeds = $this->parseManifest($manifestFile);
        $summary['feeds'] = count($feeds);

        if ($feeds === []) {
            return $summary;
        }

        File::ensureDirectoryExists($targetDirectory);

        foreach ($feeds as $feed) {
            if (!(bool) ($feed['enabled'] ?? true)) {
                $summary['skipped']++;
                continue;
            }

            try {
                $response = $this->fetchFeed($feed);
                $entries = $this->parseFeedEntries($feed, $response);
                $normalizedEntries = $this->normalizeEntries($feed, $entries);

                $filename = $this->normalizeOutputFilename((string) ($feed['name'] ?? 'feed'));
                File::put(
                    $targetDirectory . DIRECTORY_SEPARATOR . $filename . '.json',
                    json_encode([
                        'source' => $feed['source'] ?? Str::snake($filename),
                        'severity' => $feed['severity'] ?? 'high_risk',
                        'status' => $feed['status'] ?? 'active',
                        'entries' => $normalizedEntries,
                    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
                );

                $summary['downloaded']++;
                $summary['written_files']++;
                $summary['entries'] += count($normalizedEntries);
            } catch (\Throwable $exception) {
                $summary['errors'][] = [
                    'feed' => $feed['name'] ?? ($feed['url'] ?? 'unknown'),
                    'message' => $exception->getMessage(),
                ];
            }
        }

        return $summary;
    }

    private function resolveManifestPath(?string $path = null): string
    {
        $configured = trim((string) ($path ?: config('exchange_pipeline.aml.local_feeds_manifest_path')));

        if ($configured === '') {
            return database_path('data/aml_feeds/feeds.json');
        }

        return $this->resolvePath($configured);
    }

    private function resolveSourcesDirectory(?string $path = null): string
    {
        $configured = trim((string) ($path ?: config('exchange_pipeline.aml.local_sources_path')));

        if ($configured === '') {
            return database_path('data/aml_sources');
        }

        return $this->resolvePath($configured);
    }

    private function resolvePath(string $path): string
    {
        return str_starts_with($path, DIRECTORY_SEPARATOR) || preg_match('/^[A-Za-z]:[\\\\\\/]/', $path)
            ? $path
            : base_path($path);
    }

    private function parseManifest(string $manifestFile): array
    {
        $decoded = json_decode((string) File::get($manifestFile), true);
        if (!is_array($decoded)) {
            return [];
        }

        if (array_is_list($decoded)) {
            return array_values(array_filter($decoded, 'is_array'));
        }

        $feeds = $decoded['feeds'] ?? [];

        return is_array($feeds) ? array_values(array_filter($feeds, 'is_array')) : [];
    }

    private function fetchFeed(array $feed): Response
    {
        $url = trim((string) ($feed['url'] ?? ''));
        if ($url === '') {
            throw new \InvalidArgumentException('Feed url is missing.');
        }

        $headers = [];
        foreach ((array) ($feed['headers'] ?? []) as $key => $value) {
            if (!is_string($key) || !is_scalar($value)) {
                continue;
            }

            $headers[$key] = (string) $value;
        }

        $response = Http::timeout(max((int) config('exchange_pipeline.aml.local_feed_timeout', 20), 1))
            ->withHeaders($headers)
            ->get($url);

        if (!$response->successful()) {
            throw new \RuntimeException("Feed download failed with HTTP {$response->status()}.");
        }

        return $response;
    }

    private function parseFeedEntries(array $feed, Response $response): array
    {
        $format = strtolower((string) ($feed['format'] ?? 'json'));

        return match ($format) {
            'json' => $this->parseJsonEntries($feed, $response->json()),
            'csv' => $this->parseCsvEntries((string) $response->body()),
            'text', 'txt' => $this->parseTextEntries((string) $response->body()),
            default => throw new \InvalidArgumentException("Unsupported feed format: {$format}"),
        };
    }

    private function parseJsonEntries(array $feed, $payload): array
    {
        if (!is_array($payload)) {
            return [];
        }

        $entries = $payload;
        $entriesPath = trim((string) ($feed['entries_path'] ?? ''));

        if ($entriesPath !== '') {
            $entries = data_get($payload, $entriesPath, []);
        }

        if (!is_array($entries)) {
            return [];
        }

        return array_is_list($entries) ? $entries : [$entries];
    }

    private function parseCsvEntries(string $body): array
    {
        $lines = preg_split('/\r\n|\r|\n/', $body);
        if (!is_array($lines)) {
            return [];
        }

        $lines = array_values(array_filter($lines, fn ($line) => trim((string) $line) !== ''));
        if ($lines === []) {
            return [];
        }

        $header = null;
        $entries = [];

        foreach ($lines as $line) {
            $row = str_getcsv($line);

            if ($header === null) {
                $header = array_map(fn ($value) => trim((string) $value), $row);
                continue;
            }

            $entries[] = array_combine($header, array_pad($row, count($header), null)) ?: [];
        }

        return $entries;
    }

    private function parseTextEntries(string $body): array
    {
        $lines = preg_split('/\r\n|\r|\n/', $body);
        if (!is_array($lines)) {
            return [];
        }

        return array_map(fn ($line) => ['address' => trim((string) $line)], array_filter($lines, fn ($line) => trim((string) $line) !== ''));
    }

    private function normalizeEntries(array $feed, array $entries): array
    {
        $normalized = [];

        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $mapped = [];
            foreach ((array) ($feed['field_map'] ?? []) as $target => $sourcePath) {
                if (!is_string($target) || !is_string($sourcePath) || $target === '') {
                    continue;
                }

                $mapped[$target] = data_get($entry, $sourcePath);
            }

            $record = array_merge($entry, $mapped);
            $address = trim((string) ($record['address'] ?? ''));
            if ($address === '') {
                continue;
            }

            $normalized[] = array_filter([
                'address' => $address,
                'currency_code' => $this->stringOrDefault($record['currency_code'] ?? null, $feed['currency_code'] ?? null),
                'entity_name' => $this->stringOrDefault($record['entity_name'] ?? null, $feed['entity_name'] ?? null),
                'entity_type' => $this->stringOrDefault($record['entity_type'] ?? null, $feed['entity_type'] ?? null),
                'reason' => $this->stringOrDefault($record['reason'] ?? null, $feed['reason'] ?? null),
                'list_date' => $this->stringOrDefault($record['list_date'] ?? null, $feed['list_date'] ?? null),
                'severity' => $this->stringOrDefault($record['severity'] ?? null, $feed['severity'] ?? 'high_risk'),
                'status' => $this->stringOrDefault($record['status'] ?? null, $feed['status'] ?? 'active'),
                'external_id' => $this->stringOrDefault($record['external_id'] ?? null, $feed['external_id'] ?? null),
                'tags' => $record['tags'] ?? ($feed['tags'] ?? null),
                'meta' => is_array($record['meta'] ?? null) ? $record['meta'] : null,
            ], fn ($value) => $value !== null && $value !== '');
        }

        return $normalized;
    }

    private function normalizeOutputFilename(string $name): string
    {
        $normalized = trim(Str::snake($name));

        return $normalized !== '' ? $normalized : 'feed';
    }

    private function stringOrDefault($value, $default = null): ?string
    {
        $value = trim((string) ($value ?? ''));
        if ($value !== '') {
            return $value;
        }

        $default = trim((string) ($default ?? ''));

        return $default !== '' ? $default : null;
    }
}
