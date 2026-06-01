<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('fiat_currency_gateways', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fiat_currency_id')->constrained('fiat_currencies')->cascadeOnDelete();
            $table->foreignId('gateway_id')->nullable()->constrained('gateways')->cascadeOnDelete();
            $table->foreignId('fiat_send_gateway_id')->nullable()->constrained('fiat_send_gateways')->cascadeOnDelete();
            $table->string('type')->comment('buy|sell');
            $table->string('name');
            $table->text('description')->nullable();
            $table->integer('sort_by')->default(0);
            $table->tinyInteger('status')->default(1)->comment('0=>inactive,1=>active');
            $table->timestamps();

            $table->index(['fiat_currency_id', 'type', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fiat_currency_gateways');
    }
};
