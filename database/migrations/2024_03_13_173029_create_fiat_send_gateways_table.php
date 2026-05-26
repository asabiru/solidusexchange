<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('fiat_send_gateways', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('image')->nullable();
            $table->string('driver')->nullable();
            $table->text('parameters')->nullable();
            $table->text('supported_currency')->nullable();
            $table->text('description')->nullable();
            $table->boolean('status')->default(1)->comment("0=>inactive,1=>active");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('fiat_send_gateways');
    }
};
