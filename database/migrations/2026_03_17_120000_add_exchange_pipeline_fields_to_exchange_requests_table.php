<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('exchange_requests')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            if (!Schema::hasColumn('exchange_requests', 'deposit_provider')) {
                $table->string('deposit_provider', 50)->nullable()->after('crypto_method_id');
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_provider_ref')) {
                $table->string('deposit_provider_ref', 191)->nullable()->after('deposit_provider');
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_network')) {
                $table->string('deposit_network', 100)->nullable()->after('deposit_provider_ref');
            }

            if (!Schema::hasColumn('exchange_requests', 'payout_provider')) {
                $table->string('payout_provider', 50)->nullable()->after('deposit_network');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_status')) {
                $table->string('aml_status', 50)->nullable()->after('payout_provider');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_provider')) {
                $table->string('aml_provider', 50)->nullable()->after('aml_status');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_risk_level')) {
                $table->string('aml_risk_level', 50)->nullable()->after('aml_provider');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_risk_score')) {
                $table->decimal('aml_risk_score', 10, 4)->nullable()->after('aml_risk_level');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_notes')) {
                $table->text('aml_notes')->nullable()->after('aml_risk_score');
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_checked_at')) {
                $table->timestamp('aml_checked_at')->nullable()->after('aml_notes');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('exchange_requests')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            $columns = [
                'deposit_provider',
                'deposit_provider_ref',
                'deposit_network',
                'payout_provider',
                'aml_status',
                'aml_provider',
                'aml_risk_level',
                'aml_risk_score',
                'aml_notes',
                'aml_checked_at',
            ];

            $existingColumns = array_filter($columns, static fn($column) => Schema::hasColumn('exchange_requests', $column));
            if ($existingColumns !== []) {
                $table->dropColumn($existingColumns);
            }
        });
    }
};
