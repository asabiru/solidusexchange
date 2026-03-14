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
        Schema::create('sell_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->index()->nullable();
            $table->foreignId('send_currency_id')->index();
            $table->foreignId('get_currency_id')->index();
            $table->foreignId('fiat_send_gateway_id')->nullable()->index();
            $table->foreignId('crypto_method_id')->nullable()->index();
            $table->decimal('send_amount', 18, 8)->default(0.00000000);
            $table->float('get_amount')->default(0.00);
            $table->float('exchange_rate')->default(1.00)->comment("1 sendCurrency = buyCurrency");
            $table->float('processing_fee')->default(0.00);
            $table->float('final_amount')->default(0.00)->comment("After deduct all fees");
            $table->text('parameters')->nullable()->comment("information for send fiat");
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
        Schema::dropIfExists('sell_requests');
    }
};
