<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('exchange_wallets', function (Blueprint $table) {
            $table->id();
            $table->string('currency_code', 50)->index();
            $table->string('address', 255)->unique();
            $table->string('network', 100)->nullable();
            $table->string('label', 100)->nullable();
            $table->text('notes')->nullable();
            $table->boolean('status')->default(true);
            $table->string('allocation_status', 30)->default('available')->index();
            $table->foreignId('exchange_request_id')->nullable()->index();
            $table->timestamp('reserved_at')->nullable();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exchange_wallets');
    }
};
