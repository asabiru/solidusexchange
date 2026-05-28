<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('admins')) {
            return;
        }

        Schema::table('admins', function (Blueprint $table) {
            if (!Schema::hasColumn('admins', 'two_fa')) {
                $table->tinyInteger('two_fa')->default(0)->after('status');
            }

            if (!Schema::hasColumn('admins', 'two_fa_verify')) {
                $table->tinyInteger('two_fa_verify')->default(1)->after('two_fa');
            }

            if (!Schema::hasColumn('admins', 'last_seen')) {
                $table->timestamp('last_seen')->nullable()->after('last_login');
            }
        });

        DB::table('admins')->update([
            'two_fa' => 0,
            'two_fa_verify' => 1,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('admins')) {
            return;
        }

        Schema::table('admins', function (Blueprint $table) {
            foreach (['last_seen', 'two_fa_verify', 'two_fa'] as $column) {
                if (Schema::hasColumn('admins', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
