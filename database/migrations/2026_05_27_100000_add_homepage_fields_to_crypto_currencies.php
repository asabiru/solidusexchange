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
            if (!Schema::hasColumn('crypto_currencies', 'show_on_homepage')) {
                $table->boolean('show_on_homepage')->default(1)->after('status');
            }

            if (!Schema::hasColumn('crypto_currencies', 'change_24h')) {
                $table->double('change_24h')->nullable()->after('usd_rate');
            }

            if (!Schema::hasColumn('crypto_currencies', 'sparkline_7d')) {
                $table->json('sparkline_7d')->nullable()->after('change_24h');
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

            foreach (['show_on_homepage', 'change_24h', 'sparkline_7d'] as $column) {
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
