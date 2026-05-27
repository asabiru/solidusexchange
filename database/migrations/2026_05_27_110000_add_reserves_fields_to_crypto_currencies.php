<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('crypto_currencies', function (Blueprint $table) {
            $table->boolean('show_in_reserves')->default(false)->after('show_on_homepage');
            $table->decimal('reserve_amount', 20, 8)->nullable()->after('show_in_reserves');
        });
    }

    public function down(): void
    {
        Schema::table('crypto_currencies', function (Blueprint $table) {
            $table->dropColumn(['show_in_reserves', 'reserve_amount']);
        });
    }
};
