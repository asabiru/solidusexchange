<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('exchange_wallets', function (Blueprint $table) {
            $table->string('watch_provider', 50)->nullable()->after('allocation_status');
            $table->string('watch_status', 30)->default('not_configured')->after('watch_provider')->index();
            $table->string('watch_reference', 191)->nullable()->after('watch_status');
            $table->timestamp('webhook_subscribed_at')->nullable()->after('watch_reference');
            $table->text('watch_error')->nullable()->after('webhook_subscribed_at');
        });
    }

    public function down(): void
    {
        Schema::table('exchange_wallets', function (Blueprint $table) {
            $table->dropColumn([
                'watch_provider',
                'watch_status',
                'watch_reference',
                'webhook_subscribed_at',
                'watch_error',
            ]);
        });
    }
};
