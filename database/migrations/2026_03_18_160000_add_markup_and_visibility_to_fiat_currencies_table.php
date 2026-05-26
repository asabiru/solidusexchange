<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fiat_currencies', function (Blueprint $table) {
            $table->decimal('rate_markup_percent', 8, 2)->default(0)->after('usd_rate');
            $table->boolean('show_in_buy')->default(1)->after('status');
            $table->boolean('show_in_sell')->default(1)->after('show_in_buy');
        });
    }

    public function down(): void
    {
        Schema::table('fiat_currencies', function (Blueprint $table) {
            $table->dropColumn(['rate_markup_percent', 'show_in_buy', 'show_in_sell']);
        });
    }
};
