<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('exchange_requests')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            if (!Schema::hasColumn('exchange_requests', 'deposit_confirmed_at')) {
                $table->timestamp('deposit_confirmed_at')->nullable()->after('deposit_tx_id');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('exchange_requests') || !Schema::hasColumn('exchange_requests', 'deposit_confirmed_at')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            $table->dropColumn('deposit_confirmed_at');
        });
    }
};
