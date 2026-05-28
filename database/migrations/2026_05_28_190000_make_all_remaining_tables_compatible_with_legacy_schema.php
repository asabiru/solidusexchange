<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Comprehensive compatibility migration for all remaining skeleton tables.
     * Production had tables with only id/created_at/updated_at but the code
     * expects many more columns on each table.
     */
    public function up(): void
    {
        // ── 1. in_app_notifications ────────────────────────────────────
        if (Schema::hasTable('in_app_notifications')) {
            Schema::table('in_app_notifications', function (Blueprint $table) {
                if (!Schema::hasColumn('in_app_notifications', 'in_app_notificationable_type')) {
                    $table->string('in_app_notificationable_type')->nullable()->index();
                }
                if (!Schema::hasColumn('in_app_notifications', 'in_app_notificationable_id')) {
                    $table->unsignedBigInteger('in_app_notificationable_id')->nullable()->index();
                }
                if (!Schema::hasColumn('in_app_notifications', 'description')) {
                    $table->json('description')->nullable();
                }
            });
        }

        // ── 2. in_app_notification_templates ───────────────────────────
        if (Schema::hasTable('in_app_notification_templates')) {
            Schema::table('in_app_notification_templates', function (Blueprint $table) {
                if (!Schema::hasColumn('in_app_notification_templates', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable();
                }
                if (!Schema::hasColumn('in_app_notification_templates', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('in_app_notification_templates', 'template_key')) {
                    $table->string('template_key')->nullable();
                }
                if (!Schema::hasColumn('in_app_notification_templates', 'subject')) {
                    $table->string('subject')->nullable();
                }
                if (!Schema::hasColumn('in_app_notification_templates', 'in_app')) {
                    $table->longText('in_app')->nullable();
                }
                if (!Schema::hasColumn('in_app_notification_templates', 'status')) {
                    $table->json('status')->nullable();
                }
            });
        }

        // ── 3. user_kycs (table doesn't exist at all) ─────────────────
        if (!Schema::hasTable('user_kycs')) {
            Schema::create('user_kycs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->index();
                $table->unsignedBigInteger('kyc_id')->nullable()->index();
                $table->string('kyc_type')->nullable();
                $table->json('kyc_info')->nullable();
                $table->tinyInteger('status')->default(0)->comment('0=pending,1=approved,2=rejected');
                $table->string('reason')->nullable();
                $table->string('provider')->nullable()->default('manual');
                $table->string('provider_applicant_id')->nullable();
                $table->string('provider_review_status')->nullable();
                $table->string('provider_review_answer')->nullable();
                $table->json('provider_payload')->nullable();
                $table->timestamp('provider_completed_at')->nullable();
                $table->timestamps();
            });
        } else {
            Schema::table('user_kycs', function (Blueprint $table) {
                if (!Schema::hasColumn('user_kycs', 'user_id')) {
                    $table->unsignedBigInteger('user_id')->index();
                }
                if (!Schema::hasColumn('user_kycs', 'kyc_id')) {
                    $table->unsignedBigInteger('kyc_id')->nullable()->index();
                }
                if (!Schema::hasColumn('user_kycs', 'kyc_type')) {
                    $table->string('kyc_type')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'kyc_info')) {
                    $table->json('kyc_info')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'status')) {
                    $table->tinyInteger('status')->default(0);
                }
                if (!Schema::hasColumn('user_kycs', 'reason')) {
                    $table->string('reason')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider')) {
                    $table->string('provider')->nullable()->default('manual');
                }
                if (!Schema::hasColumn('user_kycs', 'provider_applicant_id')) {
                    $table->string('provider_applicant_id')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_review_status')) {
                    $table->string('provider_review_status')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_review_answer')) {
                    $table->string('provider_review_answer')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_payload')) {
                    $table->json('provider_payload')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_completed_at')) {
                    $table->timestamp('provider_completed_at')->nullable();
                }
            });
        }

        // ── 4. kycs ────────────────────────────────────────────────────
        if (Schema::hasTable('kycs')) {
            Schema::table('kycs', function (Blueprint $table) {
                if (!Schema::hasColumn('kycs', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('kycs', 'slug')) {
                    $table->string('slug')->nullable();
                }
                if (!Schema::hasColumn('kycs', 'input_form')) {
                    $table->json('input_form')->nullable();
                }
                if (!Schema::hasColumn('kycs', 'status')) {
                    $table->boolean('status')->default(0);
                }
            });
        }

        // ── 5. basic_controls (remaining missing columns) ──────────────
        if (Schema::hasTable('basic_controls')) {
            Schema::table('basic_controls', function (Blueprint $table) {
                $cols = [
                    'primary_color'           => fn() => $table->string('primary_color', 20)->nullable()->default('#00d095'),
                    'secondary_color'         => fn() => $table->string('secondary_color', 20)->nullable()->default('#000000'),
                    'admin_prefix'            => fn() => $table->string('admin_prefix', 50)->nullable()->default('admin'),
                    'is_force_ssl'            => fn() => $table->boolean('is_force_ssl')->default(0),
                    'is_maintenance_mode'     => fn() => $table->boolean('is_maintenance_mode')->default(0),
                    'strong_password'         => fn() => $table->boolean('strong_password')->default(0),
                    'sender_email'            => fn() => $table->string('sender_email')->nullable(),
                    'sender_email_name'       => fn() => $table->string('sender_email_name')->nullable(),
                    'email_description'       => fn() => $table->text('email_description')->nullable(),
                    'push_notification'       => fn() => $table->boolean('push_notification')->default(0),
                    'in_app_notification'     => fn() => $table->boolean('in_app_notification')->default(0),
                    'email_notification'      => fn() => $table->boolean('email_notification')->default(0),
                    'email_verification'      => fn() => $table->boolean('email_verification')->default(0),
                    'sms_notification'        => fn() => $table->boolean('sms_notification')->default(0),
                    'sms_verification'        => fn() => $table->boolean('sms_verification')->default(0),
                    'tawk_id'                 => fn() => $table->string('tawk_id')->nullable(),
                    'tawk_status'             => fn() => $table->boolean('tawk_status')->default(0),
                    'fb_messenger_status'     => fn() => $table->boolean('fb_messenger_status')->default(0),
                    'fb_app_id'               => fn() => $table->string('fb_app_id')->nullable(),
                    'fb_page_id'              => fn() => $table->string('fb_page_id')->nullable(),
                    'manual_recaptcha'        => fn() => $table->boolean('manual_recaptcha')->default(0),
                    'google_recaptcha'        => fn() => $table->boolean('google_recaptcha')->default(0),
                    'recaptcha_admin_login'   => fn() => $table->boolean('recaptcha_admin_login')->default(0),
                    'reCaptcha_status_login'  => fn() => $table->boolean('reCaptcha_status_login')->default(0),
                    'reCaptcha_status_registration' => fn() => $table->boolean('reCaptcha_status_registration')->default(0),
                    'measurement_id'          => fn() => $table->string('measurement_id')->nullable(),
                    'analytic_status'         => fn() => $table->boolean('analytic_status')->default(0),
                    'error_log'              => fn() => $table->boolean('error_log')->default(1),
                    'is_active_cron_notification' => fn() => $table->boolean('is_active_cron_notification')->default(0),
                    'logo'                   => fn() => $table->string('logo')->nullable(),
                    'logo_driver'            => fn() => $table->string('logo_driver', 20)->nullable()->default('local'),
                    'favicon'                => fn() => $table->string('favicon')->nullable(),
                    'favicon_driver'         => fn() => $table->string('favicon_driver', 20)->nullable()->default('local'),
                    'admin_logo'             => fn() => $table->string('admin_logo')->nullable(),
                    'admin_logo_driver'      => fn() => $table->string('admin_logo_driver', 20)->nullable()->default('local'),
                    'admin_dark_mode_logo'    => fn() => $table->string('admin_dark_mode_logo')->nullable(),
                    'admin_dark_mode_logo_driver' => fn() => $table->string('admin_dark_mode_logo_driver', 20)->nullable()->default('local'),
                    'currency_layer_access_key'    => fn() => $table->string('currency_layer_access_key')->nullable(),
                    'currency_layer_auto_update_at' => fn() => $table->string('currency_layer_auto_update_at')->nullable(),
                    'currency_layer_auto_update'   => fn() => $table->boolean('currency_layer_auto_update')->default(0),
                    'coin_market_cap_app_key'      => fn() => $table->string('coin_market_cap_app_key')->nullable(),
                    'coin_market_cap_auto_update_at' => fn() => $table->string('coin_market_cap_auto_update_at')->nullable(),
                    'coin_market_cap_auto_update'  => fn() => $table->boolean('coin_market_cap_auto_update')->default(0),
                    'automatic_payout_permission'  => fn() => $table->boolean('automatic_payout_permission')->default(0),
                    'google_reCapture_admin_login' => fn() => $table->string('google_reCapture_admin_login')->nullable(),
                    'google_reCaptcha_status_login' => fn() => $table->boolean('google_reCaptcha_status_login')->default(0),
                    'google_reCaptcha_status_registration' => fn() => $table->boolean('google_reCaptcha_status_registration')->default(0),
                    'floating_rate_update_time'    => fn() => $table->unsignedInteger('floating_rate_update_time')->default(0),
                    'floating_rate_update_status'  => fn() => $table->boolean('floating_rate_update_status')->default(0),
                    'crypto_send_time'             => fn() => $table->unsignedInteger('crypto_send_time')->default(30),
                    'fiat_send_time'               => fn() => $table->unsignedInteger('fiat_send_time')->default(30),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('basic_controls', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 6. languages - set default ──────────────────────────────────
        if (Schema::hasTable('languages')) {
            // Set first language as default if none is default
            $hasDefault = DB::table('languages')->where('default_status', 1)->exists();
            if (!$hasDefault) {
                $firstLang = DB::table('languages')->first();
                if ($firstLang) {
                    DB::table('languages')->where('id', $firstLang->id)->update(['default_status' => 1]);
                }
            }
        }

        // ── 7. notification_templates (notify_templates) ───────────────
        if (Schema::hasTable('notify_templates')) {
            Schema::table('notify_templates', function (Blueprint $table) {
                if (!Schema::hasColumn('notify_templates', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'template_key')) {
                    $table->string('template_key')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'subject')) {
                    $table->string('subject')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'email_from')) {
                    $table->string('email_from')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'short_keys')) {
                    $table->json('short_keys')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'email')) {
                    $table->longText('email')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'sms')) {
                    $table->longText('sms')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'in_app')) {
                    $table->longText('in_app')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'push')) {
                    $table->longText('push')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'status')) {
                    $table->json('status')->nullable();
                }
                if (!Schema::hasColumn('notify_templates', 'notify_for')) {
                    $table->tinyInteger('notify_for')->default(1);
                }
                if (!Schema::hasColumn('notify_templates', 'lang_code')) {
                    $table->string('lang_code', 10)->nullable();
                }
            });
        }

        // ── 8. push_notification_templates ─────────────────────────────
        if (Schema::hasTable('push_notification_templates')) {
            Schema::table('push_notification_templates', function (Blueprint $table) {
                if (!Schema::hasColumn('push_notification_templates', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable();
                }
                if (!Schema::hasColumn('push_notification_templates', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('push_notification_templates', 'template_key')) {
                    $table->string('template_key')->nullable();
                }
                if (!Schema::hasColumn('push_notification_templates', 'subject')) {
                    $table->string('subject')->nullable();
                }
                if (!Schema::hasColumn('push_notification_templates', 'push')) {
                    $table->longText('push')->nullable();
                }
                if (!Schema::hasColumn('push_notification_templates', 'status')) {
                    $table->json('status')->nullable();
                }
            });
        }

        // ── 9. firebase_notifies ───────────────────────────────────────
        if (Schema::hasTable('firebase_notifies')) {
            Schema::table('firebase_notifies', function (Blueprint $table) {
                if (!Schema::hasColumn('firebase_notifies', 'title')) {
                    $table->string('title')->nullable();
                }
                if (!Schema::hasColumn('firebase_notifies', 'description')) {
                    $table->text('description')->nullable();
                }
                if (!Schema::hasColumn('firebase_notifies', 'image')) {
                    $table->string('image')->nullable();
                }
                if (!Schema::hasColumn('firebase_notifies', 'status')) {
                    $table->boolean('status')->default(0);
                }
            });
        }

        // ── 10. fire_base_tokens ───────────────────────────────────────
        if (Schema::hasTable('fire_base_tokens')) {
            Schema::table('fire_base_tokens', function (Blueprint $table) {
                if (!Schema::hasColumn('fire_base_tokens', 'tokenable_type')) {
                    $table->string('tokenable_type')->nullable()->index();
                }
                if (!Schema::hasColumn('fire_base_tokens', 'tokenable_id')) {
                    $table->unsignedBigInteger('tokenable_id')->nullable()->index();
                }
                if (!Schema::hasColumn('fire_base_tokens', 'token')) {
                    $table->text('token')->nullable();
                }
            });
        }

        // ── 11. email_sms_templates ─────────────────────────────────────
        if (Schema::hasTable('email_sms_templates')) {
            Schema::table('email_sms_templates', function (Blueprint $table) {
                if (!Schema::hasColumn('email_sms_templates', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'template_key')) {
                    $table->string('template_key')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'subject')) {
                    $table->string('subject')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'email_from')) {
                    $table->string('email_from')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'short_keys')) {
                    $table->json('short_keys')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'email')) {
                    $table->longText('email')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'sms')) {
                    $table->longText('sms')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'in_app')) {
                    $table->longText('in_app')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'push')) {
                    $table->longText('push')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'status')) {
                    $table->json('status')->nullable();
                }
                if (!Schema::hasColumn('email_sms_templates', 'notify_for')) {
                    $table->tinyInteger('notify_for')->default(1);
                }
                if (!Schema::hasColumn('email_sms_templates', 'lang_code')) {
                    $table->string('lang_code', 10)->nullable();
                }
            });
        }

        // ── 12. email_controls ──────────────────────────────────────────
        if (Schema::hasTable('email_controls')) {
            Schema::table('email_controls', function (Blueprint $table) {
                if (!Schema::hasColumn('email_controls', 'email_method')) {
                    $table->string('email_method')->nullable()->default('smtp');
                }
                if (!Schema::hasColumn('email_controls', 'smtp_host')) {
                    $table->string('smtp_host')->nullable();
                }
                if (!Schema::hasColumn('email_controls', 'smtp_port')) {
                    $table->string('smtp_port')->nullable();
                }
                if (!Schema::hasColumn('email_controls', 'smtp_username')) {
                    $table->string('smtp_username')->nullable();
                }
                if (!Schema::hasColumn('email_controls', 'smtp_password')) {
                    $table->string('smtp_password')->nullable();
                }
                if (!Schema::hasColumn('email_controls', 'smtp_encryption')) {
                    $table->string('smtp_encryption')->nullable();
                }
                if (!Schema::hasColumn('email_controls', 'status')) {
                    $table->boolean('status')->default(1);
                }
            });
        }

        // ── 13. sms_controls ────────────────────────────────────────────
        if (Schema::hasTable('sms_controls')) {
            Schema::table('sms_controls', function (Blueprint $table) {
                if (!Schema::hasColumn('sms_controls', 'method_name')) {
                    $table->string('method_name')->nullable();
                }
                if (!Schema::hasColumn('sms_controls', 'configuration_parameters')) {
                    $table->json('configuration_parameters')->nullable();
                }
                if (!Schema::hasColumn('sms_controls', 'status')) {
                    $table->boolean('status')->default(0);
                }
            });
        }

        // ── 14. gateways ───────────────────────────────────────────────
        if (Schema::hasTable('gateways')) {
            Schema::table('gateways', function (Blueprint $table) {
                $cols = [
                    'sort_by'              => fn() => $table->unsignedInteger('sort_by')->default(0),
                    'currencies'           => fn() => $table->json('currencies')->nullable(),
                    'currency'             => fn() => $table->string('currency', 50)->nullable(),
                    'symbol'               => fn() => $table->string('symbol', 50)->nullable(),
                    'is_sandbox'           => fn() => $table->boolean('is_sandbox')->default(0),
                    'environment'          => fn() => $table->string('environment', 50)->nullable(),
                    'min_amount'           => fn() => $table->decimal('min_amount', 18, 8)->default(0),
                    'max_amount'           => fn() => $table->decimal('max_amount', 18, 8)->default(0),
                    'percentage_charge'    => fn() => $table->decimal('percentage_charge', 8, 4)->default(0),
                    'fixed_charge'         => fn() => $table->decimal('fixed_charge', 18, 8)->default(0),
                    'convention_rate'      => fn() => $table->decimal('convention_rate', 18, 8)->default(1),
                    'supported_currency'   => fn() => $table->json('supported_currency')->nullable(),
                    'receivable_currencies' => fn() => $table->json('receivable_currencies')->nullable(),
                    'note'                 => fn() => $table->text('note')->nullable(),
                    'is_subscription'      => fn() => $table->boolean('is_subscription')->default(0),
                    'subscription_status'  => fn() => $table->boolean('subscription_status')->default(0),
                    'subscription_on'      => fn() => $table->string('subscription_on')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('gateways', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 15. crypto_methods ─────────────────────────────────────────
        if (Schema::hasTable('crypto_methods')) {
            Schema::table('crypto_methods', function (Blueprint $table) {
                if (!Schema::hasColumn('crypto_methods', 'code')) {
                    $table->string('code')->nullable();
                }
                if (!Schema::hasColumn('crypto_methods', 'name')) {
                    $table->string('name')->nullable();
                }
                if (!Schema::hasColumn('crypto_methods', 'parameters')) {
                    $table->json('parameters')->nullable();
                }
                if (!Schema::hasColumn('crypto_methods', 'extra_parameters')) {
                    $table->json('extra_parameters')->nullable();
                }
                if (!Schema::hasColumn('crypto_methods', 'description')) {
                    $table->text('description')->nullable();
                }
                if (!Schema::hasColumn('crypto_methods', 'status')) {
                    $table->boolean('status')->default(0);
                }
                if (!Schema::hasColumn('crypto_methods', 'is_automatic')) {
                    $table->boolean('is_automatic')->default(1);
                }
            });
        }

        // ── 16. funds ──────────────────────────────────────────────────
        if (Schema::hasTable('funds')) {
            Schema::table('funds', function (Blueprint $table) {
                $cols = [
                    'user_id'                      => fn() => $table->unsignedBigInteger('user_id')->nullable()->index(),
                    'gateway_id'                   => fn() => $table->unsignedBigInteger('gateway_id')->nullable(),
                    'fundable_id'                  => fn() => $table->unsignedBigInteger('fundable_id')->nullable(),
                    'fundable_type'                => fn() => $table->string('fundable_type')->nullable(),
                    'gateway_currency'             => fn() => $table->string('gateway_currency')->nullable(),
                    'amount'                       => fn() => $table->decimal('amount', 18, 8)->default(0),
                    'charge'                       => fn() => $table->decimal('charge', 18, 8)->default(0),
                    'percentage_charge'            => fn() => $table->decimal('percentage_charge', 8, 4)->default(0),
                    'fixed_charge'                 => fn() => $table->decimal('fixed_charge', 18, 8)->default(0),
                    'final_amount'                 => fn() => $table->decimal('final_amount', 18, 8)->default(0),
                    'payable_amount_base_currency' => fn() => $table->decimal('payable_amount_base_currency', 18, 8)->default(0),
                    'btc_amount'                   => fn() => $table->decimal('btc_amount', 18, 8)->nullable(),
                    'btc_wallet'                   => fn() => $table->string('btc_wallet')->nullable(),
                    'transaction'                  => fn() => $table->string('transaction')->nullable(),
                    'status'                       => fn() => $table->tinyInteger('status')->default(0),
                    'detail'                       => fn() => $table->json('detail')->nullable(),
                    'feedback'                     => fn() => $table->text('feedback')->nullable(),
                    'validation_token'             => fn() => $table->string('validation_token')->nullable(),
                    'referenceno'                  => fn() => $table->string('referenceno')->nullable(),
                    'reason'                       => fn() => $table->text('reason')->nullable(),
                    'information'                  => fn() => $table->json('information')->nullable(),
                    'api_response'                 => fn() => $table->text('api_response')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('funds', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 17. wallets ────────────────────────────────────────────────
        if (Schema::hasTable('wallets')) {
            Schema::table('wallets', function (Blueprint $table) {
                $cols = [
                    'user_id'         => fn() => $table->unsignedBigInteger('user_id')->nullable()->index(),
                    'currency_id'    => fn() => $table->unsignedBigInteger('currency_id')->nullable(),
                    'currency_type'  => fn() => $table->string('currency_type', 20)->nullable(),
                    'balance'        => fn() => $table->decimal('balance', 18, 8)->default(0),
                    'locked_balance' => fn() => $table->decimal('locked_balance', 18, 8)->default(0),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('wallets', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 18. transactions ───────────────────────────────────────────
        if (Schema::hasTable('transactions')) {
            Schema::table('transactions', function (Blueprint $table) {
                $cols = [
                    'transactional_id'   => fn() => $table->unsignedBigInteger('transactional_id')->nullable(),
                    'transactional_type' => fn() => $table->string('transactional_type')->nullable(),
                    'user_id'            => fn() => $table->unsignedBigInteger('user_id')->nullable()->index(),
                    'amount'             => fn() => $table->decimal('amount', 18, 8)->default(0),
                    'balance'            => fn() => $table->decimal('balance', 18, 8)->default(0),
                    'charge'             => fn() => $table->decimal('charge', 18, 8)->default(0),
                    'trx_type'           => fn() => $table->string('trx_type', 20)->nullable(),
                    'remarks'            => fn() => $table->string('remarks')->nullable(),
                    'trx_id'             => fn() => $table->string('trx_id')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('transactions', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 19. support_tickets ────────────────────────────────────────
        if (Schema::hasTable('support_tickets')) {
            Schema::table('support_tickets', function (Blueprint $table) {
                $cols = [
                    'user_id'     => fn() => $table->unsignedBigInteger('user_id')->nullable()->index(),
                    'name'        => fn() => $table->string('name')->nullable(),
                    'email'       => fn() => $table->string('email')->nullable(),
                    'subject'     => fn() => $table->string('subject')->nullable(),
                    'message'     => fn() => $table->text('message')->nullable(),
                    'status'      => fn() => $table->tinyInteger('status')->default(0),
                    'priority'    => fn() => $table->tinyInteger('priority')->default(0),
                    'last_reply'  => fn() => $table->timestamp('last_reply')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('support_tickets', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 20. support_ticket_messages ─────────────────────────────────
        if (Schema::hasTable('support_ticket_messages')) {
            Schema::table('support_ticket_messages', function (Blueprint $table) {
                $cols = [
                    'support_ticket_id' => fn() => $table->unsignedBigInteger('support_ticket_id')->nullable()->index(),
                    'user_id'           => fn() => $table->unsignedBigInteger('user_id')->nullable(),
                    'admin_id'          => fn() => $table->unsignedBigInteger('admin_id')->nullable(),
                    'message'           => fn() => $table->text('message')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('support_ticket_messages', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 21. support_ticket_attachments ─────────────────────────────
        if (Schema::hasTable('support_ticket_attachments')) {
            Schema::table('support_ticket_attachments', function (Blueprint $table) {
                $cols = [
                    'support_ticket_message_id' => fn() => $table->unsignedBigInteger('support_ticket_message_id')->nullable()->index(),
                    'file'                      => fn() => $table->string('file')->nullable(),
                    'driver'                    => fn() => $table->string('driver', 20)->nullable()->default('local'),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('support_ticket_attachments', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 22. google_sheet_apis ──────────────────────────────────────
        if (Schema::hasTable('google_sheet_apis')) {
            Schema::table('google_sheet_apis', function (Blueprint $table) {
                $cols = [
                    'api_credential_file' => fn() => $table->string('api_credential_file')->nullable(),
                    'file_driver'         => fn() => $table->string('file_driver', 20)->nullable()->default('local'),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('google_sheet_apis', $col)) {
                        $adder();
                    }
                }
            });

            // Ensure at least one row exists for firstOrFail()
            if (DB::table('google_sheet_apis')->count() === 0) {
                DB::table('google_sheet_apis')->insert([
                    'api_credential_file' => null,
                    'file_driver' => 'local',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        // ── 23. file_storages ──────────────────────────────────────────
        if (Schema::hasTable('file_storages')) {
            Schema::table('file_storages', function (Blueprint $table) {
                $cols = [
                    'code'       => fn() => $table->string('code', 50)->nullable(),
                    'name'       => fn() => $table->string('name')->nullable(),
                    'logo'       => fn() => $table->string('logo')->nullable(),
                    'driver'     => fn() => $table->string('driver', 20)->nullable()->default('local'),
                    'status'     => fn() => $table->boolean('status')->default(0),
                    'parameters' => fn() => $table->json('parameters')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('file_storages', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 24. maintenance_modes ──────────────────────────────────────
        if (Schema::hasTable('maintenance_modes')) {
            Schema::table('maintenance_modes', function (Blueprint $table) {
                $cols = [
                    'heading'       => fn() => $table->string('heading')->nullable(),
                    'description'   => fn() => $table->text('description')->nullable(),
                    'image'         => fn() => $table->string('image')->nullable(),
                    'image_driver'  => fn() => $table->string('image_driver', 20)->nullable()->default('local'),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('maintenance_modes', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 25. user_logins ────────────────────────────────────────────
        if (Schema::hasTable('user_logins')) {
            Schema::table('user_logins', function (Blueprint $table) {
                $cols = [
                    'user_id'      => fn() => $table->unsignedBigInteger('user_id')->nullable()->index(),
                    'longitude'    => fn() => $table->string('longitude')->nullable(),
                    'latitude'     => fn() => $table->string('latitude')->nullable(),
                    'country_code' => fn() => $table->string('country_code', 10)->nullable(),
                    'location'     => fn() => $table->string('location')->nullable(),
                    'country'      => fn() => $table->string('country')->nullable(),
                    'ip_address'   => fn() => $table->string('ip_address', 50)->nullable(),
                    'browser'      => fn() => $table->string('browser')->nullable(),
                    'os'           => fn() => $table->string('os')->nullable(),
                    'get_device'   => fn() => $table->string('get_device')->nullable(),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('user_logins', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 26. manage_sections ────────────────────────────────────────
        if (Schema::hasTable('manage_sections')) {
            Schema::table('manage_sections', function (Blueprint $table) {
                $cols = [
                    'section_name' => fn() => $table->string('section_name')->nullable(),
                    'status'       => fn() => $table->boolean('status')->default(1),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('manage_sections', $col)) {
                        $adder();
                    }
                }
            });
        }

        // ── 27. manage_pages ───────────────────────────────────────────
        if (Schema::hasTable('manage_pages')) {
            Schema::table('manage_pages', function (Blueprint $table) {
                $cols = [
                    'page_name' => fn() => $table->string('page_name')->nullable(),
                    'slug'      => fn() => $table->string('slug')->nullable(),
                    'status'    => fn() => $table->boolean('status')->default(1),
                ];

                foreach ($cols as $col => $adder) {
                    if (!Schema::hasColumn('manage_pages', $col)) {
                        $adder();
                    }
                }
            });
        }
    }

    public function down(): void
    {
        // This is a one-way compatibility migration; no down() needed.
    }
};
