<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['buy_requests', 'sell_requests', 'exchange_requests'] as $tableName) {
            if (!Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (!Schema::hasColumn($tableName, 'consent_record_id')) {
                    $table->unsignedBigInteger('consent_record_id')->nullable()->index();
                }
                if (!Schema::hasColumn($tableName, 'source_channel')) {
                    $table->string('source_channel', 40)->default('web')->index();
                }
                if (!Schema::hasColumn($tableName, 'source_metadata')) {
                    $table->json('source_metadata')->nullable();
                }
                if (!Schema::hasColumn($tableName, 'sub_status')) {
                    $table->string('sub_status', 60)->nullable()->index();
                }
                if (!Schema::hasColumn($tableName, 'processing_deadline')) {
                    $table->timestamp('processing_deadline')->nullable();
                }
            });
        }

        if (Schema::hasTable('buy_requests')) {
            Schema::table('buy_requests', function (Blueprint $table) {
                $columns = [
                    'fulfillment_method' => fn() => $table->string('fulfillment_method', 60)->nullable()->index(),
                    'assigned_trader_id' => fn() => $table->unsignedBigInteger('assigned_trader_id')->nullable()->index(),
                    'assigned_at' => fn() => $table->timestamp('assigned_at')->nullable(),
                    'completed_by_trader_id' => fn() => $table->unsignedBigInteger('completed_by_trader_id')->nullable(),
                    'completed_at' => fn() => $table->timestamp('completed_at')->nullable(),
                    'cancelled_by_trader_id' => fn() => $table->unsignedBigInteger('cancelled_by_trader_id')->nullable(),
                    'cancelled_at' => fn() => $table->timestamp('cancelled_at')->nullable(),
                    'fiat_confirmed_at' => fn() => $table->timestamp('fiat_confirmed_at')->nullable(),
                    'fiat_confirmed_by' => fn() => $table->unsignedBigInteger('fiat_confirmed_by')->nullable(),
                    'crypto_tx_id' => fn() => $table->string('crypto_tx_id')->nullable(),
                    'crypto_sent_at' => fn() => $table->timestamp('crypto_sent_at')->nullable(),
                    'sbp_qr_payload' => fn() => $table->text('sbp_qr_payload')->nullable(),
                    'sbp_payment_ref' => fn() => $table->string('sbp_payment_ref')->nullable(),
                    'p2p_counterparty_info' => fn() => $table->json('p2p_counterparty_info')->nullable(),
                    'dispute_status' => fn() => $table->string('dispute_status', 40)->nullable(),
                    'dispute_reason' => fn() => $table->text('dispute_reason')->nullable(),
                    'dispute_opened_at' => fn() => $table->timestamp('dispute_opened_at')->nullable(),
                    'dispute_resolved_at' => fn() => $table->timestamp('dispute_resolved_at')->nullable(),
                    'contact_telegram' => fn() => $table->string('contact_telegram')->nullable(),
                    'contact_telegram_id' => fn() => $table->string('contact_telegram_id')->nullable(),
                    'contact_telegram_source' => fn() => $table->string('contact_telegram_source', 50)->nullable(),
                    'admin_notes' => fn() => $table->text('admin_notes')->nullable(),
                    'aml_status' => fn() => $table->string('aml_status', 30)->nullable()->index(),
                    'aml_provider' => fn() => $table->string('aml_provider', 60)->nullable(),
                    'aml_risk_level' => fn() => $table->string('aml_risk_level', 30)->nullable(),
                    'aml_risk_score' => fn() => $table->decimal('aml_risk_score', 8, 4)->nullable(),
                    'aml_notes' => fn() => $table->text('aml_notes')->nullable(),
                    'aml_checked_at' => fn() => $table->timestamp('aml_checked_at')->nullable(),
                ];

                foreach ($columns as $column => $addColumn) {
                    if (!Schema::hasColumn('buy_requests', $column)) {
                        $addColumn();
                    }
                }
            });
        }

        if (Schema::hasTable('sell_requests')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                $columns = [
                    'fulfillment_method' => fn() => $table->string('fulfillment_method', 60)->nullable()->index(),
                    'fiat_sent_at' => fn() => $table->timestamp('fiat_sent_at')->nullable(),
                    'crypto_tx_id' => fn() => $table->string('crypto_tx_id')->nullable(),
                    'crypto_confirmed_at' => fn() => $table->timestamp('crypto_confirmed_at')->nullable(),
                    'client_confirm_deadline' => fn() => $table->timestamp('client_confirm_deadline')->nullable(),
                    'client_fiat_confirmed' => fn() => $table->boolean('client_fiat_confirmed')->default(false),
                    'p2p_counterparty_info' => fn() => $table->json('p2p_counterparty_info')->nullable(),
                    'dispute_status' => fn() => $table->string('dispute_status', 40)->nullable(),
                    'dispute_reason' => fn() => $table->text('dispute_reason')->nullable(),
                    'dispute_opened_at' => fn() => $table->timestamp('dispute_opened_at')->nullable(),
                    'dispute_resolved_at' => fn() => $table->timestamp('dispute_resolved_at')->nullable(),
                    'admin_notes' => fn() => $table->text('admin_notes')->nullable(),
                    'aml_status' => fn() => $table->string('aml_status', 30)->nullable()->index(),
                    'aml_provider' => fn() => $table->string('aml_provider', 60)->nullable(),
                    'aml_risk_level' => fn() => $table->string('aml_risk_level', 30)->nullable(),
                    'aml_risk_score' => fn() => $table->decimal('aml_risk_score', 8, 4)->nullable(),
                    'aml_notes' => fn() => $table->text('aml_notes')->nullable(),
                    'aml_checked_at' => fn() => $table->timestamp('aml_checked_at')->nullable(),
                ];

                foreach ($columns as $column => $addColumn) {
                    if (!Schema::hasColumn('sell_requests', $column)) {
                        $addColumn();
                    }
                }
            });
        }

        if (Schema::hasTable('exchange_requests')) {
            Schema::table('exchange_requests', function (Blueprint $table) {
                $columns = [
                    'aml_provider_reference' => fn() => $table->string('aml_provider_reference')->nullable(),
                    'aml_raw_response' => fn() => $table->json('aml_raw_response')->nullable(),
                    'confirmation_count' => fn() => $table->unsignedInteger('confirmation_count')->nullable(),
                    'required_confirmations' => fn() => $table->unsignedInteger('required_confirmations')->nullable(),
                ];

                foreach ($columns as $column => $addColumn) {
                    if (!Schema::hasColumn('exchange_requests', $column)) {
                        $addColumn();
                    }
                }
            });
        }

        if (Schema::hasTable('users')) {
            Schema::table('users', function (Blueprint $table) {
                $columns = [
                    'telegram_id' => fn() => $table->string('telegram_id')->nullable()->index(),
                    'telegram_username' => fn() => $table->string('telegram_username')->nullable(),
                    'telegram_auth_date' => fn() => $table->timestamp('telegram_auth_date')->nullable(),
                    'telegram_payload' => fn() => $table->json('telegram_payload')->nullable(),
                    'telegram_notifications_enabled' => fn() => $table->boolean('telegram_notifications_enabled')->default(true),
                    'aml_risk_tier' => fn() => $table->string('aml_risk_tier', 30)->default('standard')->index(),
                    'lifetime_volume_usd' => fn() => $table->decimal('lifetime_volume_usd', 28, 8)->default(0),
                    'last_aml_refresh_at' => fn() => $table->timestamp('last_aml_refresh_at')->nullable(),
                ];

                foreach ($columns as $column => $addColumn) {
                    if (!Schema::hasColumn('users', $column)) {
                        $addColumn();
                    }
                }
            });
        }
    }

    public function down(): void
    {
        $tableColumns = [
            'buy_requests' => [
                'consent_record_id', 'source_channel', 'source_metadata', 'sub_status', 'processing_deadline',
                'fulfillment_method', 'assigned_trader_id', 'assigned_at', 'completed_by_trader_id', 'completed_at',
                'cancelled_by_trader_id', 'cancelled_at', 'fiat_confirmed_at', 'fiat_confirmed_by', 'crypto_tx_id',
                'crypto_sent_at', 'sbp_qr_payload', 'sbp_payment_ref', 'p2p_counterparty_info', 'dispute_status',
                'dispute_reason', 'dispute_opened_at', 'dispute_resolved_at', 'contact_telegram', 'contact_telegram_id',
                'contact_telegram_source', 'admin_notes', 'aml_status', 'aml_provider', 'aml_risk_level',
                'aml_risk_score', 'aml_notes', 'aml_checked_at',
            ],
            'sell_requests' => [
                'consent_record_id', 'source_channel', 'source_metadata', 'sub_status', 'processing_deadline',
                'fulfillment_method', 'fiat_sent_at', 'crypto_tx_id', 'crypto_confirmed_at', 'client_confirm_deadline',
                'client_fiat_confirmed', 'p2p_counterparty_info', 'dispute_status', 'dispute_reason',
                'dispute_opened_at', 'dispute_resolved_at', 'admin_notes', 'aml_status', 'aml_provider',
                'aml_risk_level', 'aml_risk_score', 'aml_notes', 'aml_checked_at',
            ],
            'exchange_requests' => [
                'consent_record_id', 'source_channel', 'source_metadata', 'sub_status', 'processing_deadline',
                'aml_provider_reference', 'aml_raw_response', 'confirmation_count', 'required_confirmations',
            ],
            'users' => [
                'telegram_id', 'telegram_username', 'telegram_auth_date', 'telegram_payload',
                'telegram_notifications_enabled', 'aml_risk_tier', 'lifetime_volume_usd', 'last_aml_refresh_at',
            ],
        ];

        foreach ($tableColumns as $tableName => $columns) {
            if (!Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName, $columns) {
                $existing = array_values(array_filter($columns, fn(string $column) => Schema::hasColumn($tableName, $column)));
                if ($existing !== []) {
                    $table->dropColumn($existing);
                }
            });
        }
    }
};
