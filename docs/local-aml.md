# Local AML

This repository now supports a fully local AML mode without paid providers.

## What is included

- `local_db` AML provider enabled by default in `.env.example`
- offline wallet and deposit screening using `sanctioned_addresses`
- local JSON/CSV watchlist sync command: `aml:sync-local-sources`
- automatic public feed refresh command: `aml:refresh-local-feeds`
- starter local datasets in `database/data/aml_sources`
- starter feed manifest in `database/data/aml_feeds/feeds.json`
- no external OFAC/API calls when `EXCHANGE_AML_PROVIDER=local_db` or `manual`

## Local source files

Default directory:

```text
database/data/aml_sources
```

Supported formats:

- `.json`
- `.csv`

### JSON format

```json
{
  "source": "local_osint",
  "severity": "high_risk",
  "entries": [
    {
      "address": "0xabc123",
      "currency_code": "ETH",
      "entity_name": "Example",
      "entity_type": "mixer",
      "reason": "OSINT source",
      "tags": ["mixer", "sanctions"]
    }
  ]
}
```

### CSV format

```csv
address,currency_code,source,entity_name,entity_type,severity,reason
0xabc123,ETH,local_osint,Example,mixer,blocked,OSINT source
```

## Sync command

```bash
php artisan aml:sync-local-sources
php artisan aml:sync-local-sources --prune
php artisan aml:sync-local-sources --path=/absolute/path/to/aml_sources
```

Use `--prune` only when your local source files are the full source of truth for that feed/source.

## Automatic feed refresh

Default manifest:

```text
database/data/aml_feeds/feeds.json
```

The refresh command downloads public feeds, converts them into local AML source files, and then syncs them into `sanctioned_addresses`.

```bash
php artisan aml:refresh-local-feeds
php artisan aml:refresh-local-feeds --prune
php artisan aml:refresh-local-feeds --manifest=/absolute/path/to/feeds.json --path=/absolute/path/to/aml_sources --prune
```

Example feed definitions are already included in:

```text
database/data/aml_feeds/feeds.json
```

Supported feed formats:

- `json`
- `csv`
- `text`

## Suggested routine

1. Keep local source files under version control or upload them to the server
2. Configure public feed URLs in `database/data/aml_feeds/feeds.json`
3. Run `php artisan aml:refresh-local-feeds`
4. Let the scheduler refresh local AML automatically twice a day

## Current local heuristics

- exact blocked matches => reject
- exact `high_risk` / `monitor` matches => manual review
- partial prefix matches => manual review
- privacy coin penalty
- large amount penalty
- repeated small deposits from the same address
- same source address hitting multiple custodial wallets
- previous flagged AML logs for the same address
