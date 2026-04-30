<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('crypto_currencies')) {
            return;
        }

        Schema::table('crypto_currencies', function (Blueprint $table) {
            if (!Schema::hasColumn('crypto_currencies', 'usd_rate')) {
                $table->double('usd_rate')->default(1)->after('rate');
            }

            if (!Schema::hasColumn('crypto_currencies', 'min_send')) {
                $table->double('min_send')->default(0)->after('network_fee_type');
            }

            if (!Schema::hasColumn('crypto_currencies', 'max_send')) {
                $table->double('max_send')->default(0)->after('min_send');
            }

            if (!Schema::hasColumn('crypto_currencies', 'sort_by')) {
                $table->unsignedInteger('sort_by')->default(0)->after('status');
            }

            if (!Schema::hasColumn('crypto_currencies', 'deleted_at')) {
                $table->softDeletes();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('crypto_currencies')) {
            return;
        }

        Schema::table('crypto_currencies', function (Blueprint $table) {
            $dropColumns = [];

            foreach (['usd_rate', 'min_send', 'max_send', 'sort_by', 'deleted_at'] as $column) {
                if (Schema::hasColumn('crypto_currencies', $column)) {
                    $dropColumns[] = $column;
                }
            }

            if ($dropColumns !== []) {
                $table->dropColumn($dropColumns);
            }
        });
    }
};
