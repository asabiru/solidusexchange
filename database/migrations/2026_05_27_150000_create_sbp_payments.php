<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // SBP QR payments — tracks all SBP payment attempts
        Schema::create('sbp_payments', function (Blueprint $table) {
            $table->id();
            $table->string('order_id')->nullable()->index();        // Our internal order ID
            $table->string('provider_payment_id')->nullable()->index(); // Tinkoff PaymentId
            $table->string('provider', 30)->default('tinkoff');     // tinkoff, static_qr, manual
            $table->decimal('amount', 20, 2);                       // RUB amount
            $table->string('currency_code', 10)->default('RUB');
            $table->text('qr_url')->nullable();                     // QR code image URL
            $table->text('qr_payload')->nullable();                 // NSPK payload string
            $table->enum('status', ['pending', 'paid', 'confirmed', 'rejected', 'refunded', 'expired'])->default('pending')->index();
            $table->string('purpose')->nullable();                  // Payment purpose/description
            $table->timestamp('expires_at')->nullable();            // QR expiration time
            $table->timestamp('paid_at')->nullable();               // When payment was received
            $table->timestamp('confirmed_at')->nullable();         // When admin confirmed
            $table->json('provider_response')->nullable();          // Raw API response
            $table->json('meta')->nullable();                       // Additional data
            // Polymorphic relation: can be linked to SellRequest, BuyRequest, etc.
            $table->string('payable_type')->nullable();
            $table->unsignedBigInteger('payable_id')->nullable();
            $table->timestamps();

            $table->index(['payable_type', 'payable_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sbp_payments');
    }
};
