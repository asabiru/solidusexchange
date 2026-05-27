<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            $table->decimal('balance', 20, 8)->default(0)->after('last_deposit_amount');
        });
    }

    public function down(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            $table->dropColumn('balance');
        });
    }
};
