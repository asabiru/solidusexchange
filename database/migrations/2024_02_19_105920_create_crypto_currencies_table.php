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
        Schema::create('crypto_currencies', function (Blueprint $table) {
            $table->id();
            $table->string('name')->nullable();
            $table->string('code')->nullable();
            $table->string('symbol')->nullable();
            $table->double('rate')->default(1.00)->comment("Rate equivalent USD");
            $table->decimal('service_fee')->default(0.00000000)->comment("In crypto");
            $table->enum('service_fee_type', ['percent', 'flat'])->default('percent');
            $table->decimal('network_fee')->default(0.00000000)->comment("In crypto");
            $table->enum('network_fee_type', ['percent', 'flat'])->default('percent');
            $table->text('image')->nullable();
            $table->string('driver')->default('local');
            $table->boolean('status')->default(1)->comment("0=>inactive,1=>active");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('crypto_currencies');
    }
};
