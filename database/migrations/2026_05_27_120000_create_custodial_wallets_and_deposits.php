<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Custodial wallets — deposit addresses generated per-exchange or reusable
        Schema::create('custodial_wallets', function (Blueprint $table) {
            $table->id();
            $table->string('currency_code', 20)->index();
            $table->string('network', 30)->nullable();
            $table->string('address')->unique();
            $table->string('derivation_path')->nullable();
            $table->string('provider', 30)->default('crypto_cloud'); // crypto_cloud, crypto_apis, manual
            $table->string('provider_reference')->nullable(); // UUID from provider
            $table->enum('purpose', ['deposit', 'payout', 'both'])->default('deposit');
            $table->enum('status', ['active', 'frozen', 'retired'])->default('active');
            $table->unsignedBigInteger('assigned_exchange_id')->nullable()->index();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('last_deposit_at')->nullable();
            $table->string('last_deposit_tx_id')->nullable();
            $table->decimal('last_deposit_amount', 20, 8)->nullable();
            $table->timestamps();

            $table->foreign('assigned_exchange_id')->references('id')->on('exchange_requests')->nullOnDelete();
        });

        // Custodial deposits — tracks incoming crypto deposits to custodial wallets
        Schema::create('custodial_deposits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('custodial_wallet_id')->index();
            $table->string('currency_code', 20)->index();
            $table->string('tx_id')->nullable();
            $table->string('tx_hash')->nullable();
            $table->decimal('amount', 20, 8);
            $table->unsignedInteger('confirmations')->default(0);
            $table->enum('status', ['pending', 'confirmed', 'aml_check', 'aml_approved', 'aml_rejected', 'processed'])->default('pending');
            $table->string('source_address')->nullable();
            $table->unsignedBigInteger('exchange_request_id')->nullable()->index();
            $table->unsignedBigInteger('buy_request_id')->nullable()->index();
            $table->unsignedBigInteger('sell_request_id')->nullable()->index();
            $table->timestamp('detected_at')->nullable();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('aml_checked_at')->nullable();
            $table->string('aml_provider', 30)->nullable();
            $table->string('aml_risk_level', 20)->nullable();
            $table->decimal('aml_risk_score', 5, 2)->nullable();
            $table->text('aml_notes')->nullable();
            $table->timestamps();

            $table->foreign('custodial_wallet_id')->references('id')->on('custodial_wallets')->cascadeOnDelete();
            $table->foreign('exchange_request_id')->references('id')->on('exchange_requests')->nullOnDelete();
            $table->foreign('buy_request_id')->references('id')->on('buy_requests')->nullOnDelete();
            $table->foreign('sell_request_id')->references('id')->on('sell_requests')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custodial_deposits');
        Schema::dropIfExists('custodial_wallets');
    }
};
