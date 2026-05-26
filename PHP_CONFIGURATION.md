# PHP Configuration - Solidus Exchange Server

## Date: 2026-05-26

## Available PHP Versions on Server

### CLI Versions:
- PHP 5.2.17 (default) - `/usr/bin/php` ❌ Too old for Laravel
- PHP 7.1.33 - `/usr/lib64/php7.1/bin/php` ❌ Composer requires 8.2+
- **PHP 8.2.x - `/usr/lib64/php8.2/bin/php` ✅ WORKS CORRECTLY**
- PHP 8.3.x - `/usr/lib64/php8.3/bin/php`
- PHP 8.4.x - `/usr/lib64/php8.4/bin/php`
- PHP 8.5.x - `/usr/lib64/php8.5/bin/php`

### Apache Version:
- Apache 2.2
- Uses PHP 7.1 via mod_php

## Solution

### Use PHP 8.2 for Artisan Commands
```bash
ssh solidus "cd ~/solidus/public_html && /usr/lib64/php8.2/bin/php artisan cache:clear"
```

### Available Aliases (configured in ~/.bashrc):
- `artisan` - runs PHP 8.2 artisan commands
- `php8` - runs PHP 8.2 CLI

### Example Usage:
```bash
# Clear cache
ssh solidus "cd ~/solidus/public_html && artisan cache:clear"

# Run migrations
ssh solidus "cd ~/solidus/public_html && artisan migrate"

# Clear all caches
ssh solidus "cd ~/solidus/public_html && artisan cache:clear && artisan config:clear && artisan view:clear"
```

## SSH Access
- **Configured**: Passwordless SSH keys
- **Alias**: `ssh solidus "command"`
- **Project path**: `~/solidus/public_html`

## Note
- Apache uses PHP 7.1 for web requests
- Use PHP 8.2 for CLI/artisan commands
- Both versions work correctly for their purposes