<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'telegram_id')) {
                $table->string('telegram_id')->nullable()->unique();
            }

            if (!Schema::hasColumn('users', 'telegram_username')) {
                $table->string('telegram_username')->nullable();
            }

            if (!Schema::hasColumn('users', 'telegram_auth_date')) {
                $table->timestamp('telegram_auth_date')->nullable();
            }

            if (!Schema::hasColumn('users', 'telegram_linked_at')) {
                $table->timestamp('telegram_linked_at')->nullable();
            }

            if (!Schema::hasColumn('users', 'telegram_payload')) {
                $table->json('telegram_payload')->nullable();
            }

            if (!Schema::hasColumn('users', 'telegram_notifications_enabled')) {
                $table->boolean('telegram_notifications_enabled')->default(true);
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $columns = [
                'telegram_id',
                'telegram_username',
                'telegram_auth_date',
                'telegram_linked_at',
                'telegram_payload',
                'telegram_notifications_enabled',
            ];

            foreach ($columns as $column) {
                if (Schema::hasColumn('users', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
