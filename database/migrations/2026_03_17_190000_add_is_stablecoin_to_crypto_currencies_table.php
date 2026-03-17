<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('crypto_currencies', function (Blueprint $table) {
            if (!Schema::hasColumn('crypto_currencies', 'is_stablecoin')) {
                $table->boolean('is_stablecoin')->default(false)->after('status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('crypto_currencies', function (Blueprint $table) {
            if (Schema::hasColumn('crypto_currencies', 'is_stablecoin')) {
                $table->dropColumn('is_stablecoin');
            }
        });
    }
};
