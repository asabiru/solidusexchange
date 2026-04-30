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
            if (!Schema::hasColumn('exchange_requests', 'execution_route')) {
                $table->string('execution_route', 50)->nullable()->after('payout_provider');
            }

            if (!Schema::hasColumn('exchange_requests', 'matched_exchange_request_id')) {
                $table->unsignedBigInteger('matched_exchange_request_id')->nullable()->after('execution_route')->index();
            }

            if (!Schema::hasColumn('exchange_requests', 'execution_notes')) {
                $table->text('execution_notes')->nullable()->after('matched_exchange_request_id');
            }

            if (!Schema::hasColumn('exchange_requests', 'routed_at')) {
                $table->timestamp('routed_at')->nullable()->after('execution_notes');
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
                'execution_route',
                'matched_exchange_request_id',
                'execution_notes',
                'routed_at',
            ];

            $existingColumns = array_filter($columns, static fn($column) => Schema::hasColumn('exchange_requests', $column));
            if ($existingColumns !== []) {
                $table->dropColumn($existingColumns);
            }
        });
    }
};
