<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['crypto_currencies', 'fiat_currencies'] as $tableName) {
            if (!Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (!Schema::hasColumn($tableName, 'last_rate_sync_at')) {
                    $table->timestamp('last_rate_sync_at')->nullable();
                }

                if (!Schema::hasColumn($tableName, 'last_rate_sync_error')) {
                    $table->text('last_rate_sync_error')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        foreach (['crypto_currencies', 'fiat_currencies'] as $tableName) {
            if (!Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                $dropColumns = [];

                if (Schema::hasColumn($tableName, 'last_rate_sync_error')) {
                    $dropColumns[] = 'last_rate_sync_error';
                }

                if (Schema::hasColumn($tableName, 'last_rate_sync_at')) {
                    $dropColumns[] = 'last_rate_sync_at';
                }

                if ($dropColumns !== []) {
                    $table->dropColumn($dropColumns);
                }
            });
        }
    }
};
