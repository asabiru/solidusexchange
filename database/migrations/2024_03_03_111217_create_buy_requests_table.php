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
        Schema::create('buy_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->index()->nullable();
            $table->foreignId('send_currency_id')->index();
            $table->foreignId('get_currency_id')->index();
            $table->float('send_amount')->default(0.00);
            $table->decimal('get_amount', 18, 8)->default(0.00000000);
            $table->decimal('exchange_rate', 18, 8)->default(1.00000000)->comment("1 sendCurrency = buyCurrency");
            $table->decimal('service_fee', 18, 8)->default(0.00000000);
            $table->decimal('network_fee', 18, 8)->default(0.00000000);
            $table->decimal('final_amount', 18, 8)->default(0.00000000)->comment("After deduct all fees");
            $table->string('destination_wallet')->nullable()->comment("which address crypto send");
            $table->tinyInteger('status')->default(0)->comment("0=>initiate,1=>give_address,2=>deposit_amount,3=>exchange_completed,5=>cancel,6=>refund");
            $table->softDeletes();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('buy_requests');
    }
};
