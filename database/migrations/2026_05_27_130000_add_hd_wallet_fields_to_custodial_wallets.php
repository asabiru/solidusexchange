<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            $table->unsignedInteger('hd_wallet_index')->nullable()->after('derivation_path');
            $table->text('encrypted_private_key')->nullable()->after('hd_wallet_index');
            $table->timestamp('last_checked_at')->nullable()->after('last_deposit_amount');
        });
    }

    public function down(): void
    {
        Schema::table('custodial_wallets', function (Blueprint $table) {
            $table->dropColumn(['hd_wallet_index', 'encrypted_private_key', 'last_checked_at']);
        });
    }
};
