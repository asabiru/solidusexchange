<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            if (!Schema::hasColumn('custodial_wallets', 'trader_id')) {
                // trader_id references admins table (role=trader)
                $table->unsignedBigInteger('trader_id')->nullable()->after('id')->index();
            }
        });
    }

    public function down(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            if (Schema::hasColumn('custodial_wallets', 'trader_id')) {
                $table->dropColumn('trader_id');
            }
        });
    }
};
