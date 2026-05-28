<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('admins') && !Schema::hasColumn('admins', 'two_fa_code')) {
            Schema::table('admins', function (Blueprint $table) {
                $table->string('two_fa_code', 50)->nullable()->after('two_fa_verify');
            });
        }

        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'two_fa_code')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('two_fa_code', 50)->nullable()->after('two_fa_verify');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('admins') && Schema::hasColumn('admins', 'two_fa_code')) {
            Schema::table('admins', function (Blueprint $table) {
                $table->dropColumn('two_fa_code');
            });
        }

        if (Schema::hasTable('users') && Schema::hasColumn('users', 'two_fa_code')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('two_fa_code');
            });
        }
    }
};
