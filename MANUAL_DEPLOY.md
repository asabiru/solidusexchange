# Manual Deployment Instructions

## Latest Changes (2026-05-26)
**Fiat Currency Functionality Restored:**
- Restored Buy/Sell tabs with fiat currency functionality while keeping new design
- Buy tab: Fiat currency → Cryptocurrency (e.g., USD → BTC)
- Sell tab: Cryptocurrency → Fiat currency (e.g., BTC → USD)
- Exchange tab: Cryptocurrency → Cryptocurrency (as before)
- Added public routes for buy/sell requests for non-authenticated users
- Updated hero.blade.php with mode switching and dynamic currency loading
- Non-auth users redirected to login with pending request stored in session

**Previous Green Color Fix:**
- Replaced all green colors with champagne/gold (#e8c9a0) to match eazy228/design
- Changed in `style.css`: --color-success, --lime-green-rgb
- Changed in `dashboard.css`: --color-success, --soft-green, --lime-green, --grayish-green
- All green elements now use champagne theme colors

## Previous Changes Made
1. **Removed theme toggle** from header - now single champagne/dark theme
2. **Created new homepage** (`home.blade.php`) with eazy228/design sections:
   - Hero Section (with exchange form)
   - Rates Section
   - Popular Cryptos Section
   - Security & AML Section
   - How It Works Section
   - Advantages Section
   - Reserves Section
   - Reviews Section
   - FAQ Section
   - Footer Section (new)
3. **Added home route** - `/` now points to new homepage
4. **Created footer.blade.php** - modern footer with social links and contact info
5. **Updated app.blade.php** - skips old footer on homepage

## Files Changed
- `resources/views/themes/light/partials/header.blade.php` - removed theme toggle
- `resources/views/themes/light/home.blade.php` - new homepage
- `resources/views/themes/light/sections/footer.blade.php` - new footer section
- `resources/views/themes/light/layouts/app.blade.php` - conditional footer
- `app/Http/Controllers/FrontendController.php` - added home() method
- `routes/web.php` - added /home route

## Deployment Steps

### Option 1: Beget Control Panel (Recommended)
1. Log in to Beget control panel
2. Go to "Git" section
3. Find your repository
4. Click "Pull" button to deploy latest changes

### Option 2: SSH Access
If you have SSH access:
```bash
ssh wabeitvkco@wabeitvkco.beget.tech
cd /home/w/wabeitvkco/solidus/public_html
git pull origin master
php artisan cache:clear
php artisan config:clear
php artisan view:clear
```

### Option 3: Manual File Upload
If automatic deployment doesn't work:
1. Download the changed files from GitHub
2. Upload them to the server via FTP/Beget file manager
3. Clear Laravel cache

## Verification
After deployment, visit https://solidchange.online and verify:
- Homepage shows new sections (Rates, Reserves, How It Works)
- Header buttons work correctly
- No theme toggle button
- New footer is displayed
- Old sections (about, feature, why-choose-us) are removed

## Troubleshooting
If you see errors after deployment:
1. Clear Laravel cache: `php artisan cache:clear`
2. Clear config cache: `php artisan config:clear`
3. Clear view cache: `php artisan view:clear`
4. Check Laravel logs: `storage/logs/laravel.log`