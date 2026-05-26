<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fiat_currencies', function (Blueprint $table) {
            $table->foreignId('buy_gateway_id')->nullable()->after('show_in_buy')
                ->constrained('gateways')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('fiat_currencies', function (Blueprint $table) {
            $table->dropConstrainedForeignId('buy_gateway_id');
        });
    }
};
