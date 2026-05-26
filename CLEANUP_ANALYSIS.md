# Solidus Exchange - Code Cleanup Analysis

## Date: 2026-05-26

## 1. UNUSED CONFIGURATION OPTIONS

### Social Login Providers (Potentially Unused)
**Files**: `.env.example`, config files
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`  
- `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_REDIRECT_URL`

**Recommendation**: If social login is not actively used, remove these configurations and related controllers:
- `app/Http/Controllers/SocialiteController.php`
- Related routes in `web.php`

### Multiple SMS Providers (Consolidate)
**Files**: `.env.example`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `INFOBIP_API_KEY`, `INFOBIP_URL_BASE_PATH`
- `PLIVO_ID`, `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`
- `VONAGE_API_KEY`, `VONAGE_API_SECRET`

**Recommendation**: Keep only the actively used SMS provider and remove others.

### Email Service Providers (Consolidate)
**Files**: `.env.example`
- `MAILGUN_DOMAIN`, `MAILGUN_SECRET`
- `POSTMARK_TOKEN`
- `MAILERSEND_API_KEY`
- `SENDINBLUE_API_KEY`
- `SENDGRID_API_KEY`
- `MAILCHIMP_API_KEY`

**Recommendation**: Keep only the active email provider and remove others.

## 2. UNUSED FILE SYSTEM DRIVERS

**Files**: `.env.example`
- AWS S3 configuration
- DigitalOcean Spaces configuration
- SFTP configuration
- FTP configuration

**Recommendation**: If using only local storage, remove cloud storage configurations.

## 3. UNUSED DATABASE TABLES

### Potentially Unused Tables:
- `firebase_notifies` (if Firebase not used)
- `user_logins` (if login tracking not needed)
- `jobs` (if queue system not used)

**Recommendation**: Verify usage before removal.

## 4. UNUSED CONTROLLERS/METHODS

### Controllers to Review:
1. **SocialiteController**: If social login not used
2. **ManualRecaptchaController**: If using Google reCAPTCHA instead
3. **SumsubWebhookController**: If using different KYC provider

### Controller Methods to Review:
- Check for unused methods in each controller
- Remove commented-out code
- Remove debug routes

## 5. UNUSED VIEWS/TEMPLATES

### Potentially Unused Views:
- `resources/views/admin/coin-announce/*` (if coin announcements not used)
- `resources/views/admin/plugin_controls/*` (if plugins not used)
- Legacy error pages in `resources/views/errors/` (if using theme errors)

### Recommendation**: Check if these features are actively used before removal.

## 6. UNUSED CSS/JS FILES

### CSS Files to Review:
- `assets/themes/light/css/docs.min.css` (if documentation not public)
- `assets/themes/light/css/androidstudio.min.css` (if code highlighting not used)
- `assets/themes/light/css/darcula.min.css` (if alternative theme not used)

### JS Files to Review:
- `assets/themes/light/js/jquery.skitter.min.js` (if skitter slider not used)
- `assets/themes/light/js/jquery.exzoom.js` (if image zoom not used)
- `assets/themes/light/js/qrjs2.min.js` (if QR code generation not used)

## 7. UNUSED ROUTES

### Debug Routes:
- `__routecheck` - Debug route (should be removed in production)
- Any other debug/test routes

### Legacy Routes:
- Check for old route patterns that are no longer used
- Remove redirect routes for deprecated pages

## 8. UNUSED DEPENDENCIES

### Composer Dependencies to Review:
```json
// Check composer.json for unused packages
- Laravel packages that aren't used
- Development dependencies that can be removed
```

### NPM Dependencies to Review:
```json
// Check package.json for unused packages
- JavaScript libraries that aren't referenced
- Development dependencies
```

## 9. COMMENTED CODE

### Files to Check:
- Controllers: Look for commented-out methods
- Views: Look for commented HTML/Blade code
- Routes: Look for commented route definitions
- Config files: Look for commented configuration options

**Recommendation**: Remove all commented code that is not needed for reference.

## 10. UNUSED MIGRATIONS

### Old Migrations:
- Review migration files for deprecated features
- Consider consolidating related migrations

## 11. CLEANUP PRIORITY

### High Priority (Safe to Remove):
1. Debug routes (`__routecheck`)
2. Commented code blocks
3. Unused CSS/JS files (verified not referenced)
4. Deprecated social login configs (if not used)

### Medium Priority (Verify First):
1. Alternative SMS provider configs
2. Alternative email provider configs
3. Cloud storage configs (if using local only)
4. Unused controller methods

### Low Priority (Review Carefully):
1. Database tables (verify no dependencies)
2. Views that might be conditionally used
3. Migrations (might be needed for fresh installs)

## 12. CLEANUP SCRIPTS

### Suggested Cleanup Commands:

```bash
# Find unused CSS files
grep -r "filename" assets/themes/light/css/ resources/views/

# Find unused JS files  
grep -r "filename" assets/themes/light/js/ resources/views/

# Find commented code in PHP files
grep -r "^\s*//" app/ --include="*.php"

# Find commented routes
grep -r "^\s*//" routes/
```

## 13. RECOMMENDED CLEANUP PROCESS

1. **Backup**: Create a full backup before cleanup
2. **Test**: Ensure application is working before cleanup
3. **Incremental**: Remove items one category at a time
4. **Test After Each**: Test application after each cleanup category
5. **Document**: Document what was removed and why

## 14. SPECIFIC RECOMMENDATIONS

### Immediate Cleanup (Safe):
1. Remove debug route `__routecheck`
2. Remove commented code blocks
3. Remove unused CSS: `androidstudio.min.css`, `darcula.min.css`
4. Remove unused JS: `jquery.skitter.min.js`, `jquery.exzoom.js`

### Configuration Cleanup:
1. If social login not used: Remove socialite configs and SocialiteController
2. If using only one SMS provider: Remove other SMS configs
3. If using only one email provider: Remove other email configs
4. If using local storage only: Remove cloud storage configs

### Feature Cleanup:
1. If coin announcements not used: Remove related views and routes
2. If plugins not used: Remove plugin controls
3. If Firebase not used: Remove Firebase configuration

---

**Note**: This analysis should be verified with actual usage data before removing any features. Some items marked as potentially unused might be used in specific scenarios or by specific users.