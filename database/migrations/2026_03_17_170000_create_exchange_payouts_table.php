<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('exchange_payouts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('exchange_request_id')->nullable()->index();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('type', 20)->index();
            $table->string('provider', 50)->index();
            $table->string('currency_code', 50);
            $table->decimal('amount', 28, 16);
            $table->string('destination_wallet', 255);
            $table->string('status', 30)->default('queued')->index();
            $table->string('tx_id', 191)->nullable();
            $table->string('external_reference', 191)->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exchange_payouts');
    }
};
