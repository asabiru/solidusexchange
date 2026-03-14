<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('admins') && !Schema::hasColumn('admins', 'telegram_username')) {
            Schema::table('admins', function (Blueprint $table) {
                $table->string('telegram_username', 50)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('admins') && Schema::hasColumn('admins', 'telegram_username')) {
            Schema::table('admins', function (Blueprint $table) {
                $table->dropColumn('telegram_username');
            });
        }
    }
};
