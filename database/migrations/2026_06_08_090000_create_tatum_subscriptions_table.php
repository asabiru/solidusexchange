<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tatum_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->string('tatum_id')->unique()->comment('Tatum subscription ID');
            $table->unsignedBigInteger('wallet_id')->nullable()->index();
            $table->string('address', 256)->index();
            $table->string('chain', 60)->index();
            $table->string('currency_code', 30);
            $table->string('type', 60)->default('INCOMING_NATIVE_TX');
            $table->string('contract_address', 256)->nullable();
            $table->string('status', 20)->default('active')->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tatum_subscriptions');
    }
};
