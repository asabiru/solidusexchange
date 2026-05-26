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
        Schema::create('exchange_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->index();
            $table->foreignId('send_currency_id')->index();
            $table->foreignId('get_currency_id')->index();
            $table->decimal('send_amount', 18, 8)->default(0.00000000);
            $table->decimal('get_amount', 18, 8)->default(0.00000000);
            $table->decimal('exchange_rate', 18, 8)->default(1.00000000);
            $table->decimal('service_fee', 18, 8)->default(0.00000000);
            $table->decimal('network_fee', 18, 8)->default(0.00000000);
            $table->decimal('final_amount', 18, 8)->default(0.00000000)->comment("After deduct all fees");
            $table->tinyInteger('status')->default(0)->comment("0=>initiate,1=>give_address,2=>deposit_amount,3=>exchange_completed");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('exchange_requests');
    }
};
