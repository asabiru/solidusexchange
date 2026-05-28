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
                $column = $table->string('deposit_provider', 50)->nullable();

                if (Schema::hasColumn('exchange_requests', 'crypto_method_id')) {
                    $column->after('crypto_method_id');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_provider_ref')) {
                $column = $table->string('deposit_provider_ref', 191)->nullable();

                if (Schema::hasColumn('exchange_requests', 'deposit_provider')) {
                    $column->after('deposit_provider');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_network')) {
                $column = $table->string('deposit_network', 100)->nullable();

                if (Schema::hasColumn('exchange_requests', 'deposit_provider_ref')) {
                    $column->after('deposit_provider_ref');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'payout_provider')) {
                $column = $table->string('payout_provider', 50)->nullable();

                if (Schema::hasColumn('exchange_requests', 'deposit_network')) {
                    $column->after('deposit_network');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_status')) {
                $column = $table->string('aml_status', 50)->nullable();

                if (Schema::hasColumn('exchange_requests', 'payout_provider')) {
                    $column->after('payout_provider');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_provider')) {
                $column = $table->string('aml_provider', 50)->nullable();

                if (Schema::hasColumn('exchange_requests', 'aml_status')) {
                    $column->after('aml_status');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_risk_level')) {
                $column = $table->string('aml_risk_level', 50)->nullable();

                if (Schema::hasColumn('exchange_requests', 'aml_provider')) {
                    $column->after('aml_provider');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_risk_score')) {
                $column = $table->decimal('aml_risk_score', 10, 4)->nullable();

                if (Schema::hasColumn('exchange_requests', 'aml_risk_level')) {
                    $column->after('aml_risk_level');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_notes')) {
                $column = $table->text('aml_notes')->nullable();

                if (Schema::hasColumn('exchange_requests', 'aml_risk_score')) {
                    $column->after('aml_risk_score');
                }
            }

            if (!Schema::hasColumn('exchange_requests', 'aml_checked_at')) {
                $column = $table->timestamp('aml_checked_at')->nullable();

                if (Schema::hasColumn('exchange_requests', 'aml_notes')) {
                    $column->after('aml_notes');
                }
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
