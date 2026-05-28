<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('basic_controls')) {
            return;
        }

        Schema::table('basic_controls', function (Blueprint $table) {
            if (!Schema::hasColumn('basic_controls', 'exchange_rate')) {
                $table->decimal('exchange_rate', 18, 8)->default(1)->after('has_space_between_currency_and_amount');
            }
        });

        DB::table('basic_controls')->update([
            'exchange_rate' => 1,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('basic_controls') || !Schema::hasColumn('basic_controls', 'exchange_rate')) {
            return;
        }

        Schema::table('basic_controls', function (Blueprint $table) {
            $table->dropColumn('exchange_rate');
        });
    }
};
