<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('custodial_withdrawals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custodial_wallet_id')->constrained()->cascadeOnDelete();
            $table->string('currency_code', 20);
            $table->string('from_address');
            $table->string('to_address');
            $table->decimal('amount', 20, 8);
            $table->decimal('fee', 20, 8)->default(0);
            $table->string('txid')->nullable();
            $table->enum('status', ['pending', 'approved', 'processing', 'completed', 'failed', 'rejected'])->default('pending');
            $table->text('error')->nullable();
            $table->text('note')->nullable();
            $table->timestamp('executed_at')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index('currency_code');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custodial_withdrawals');
    }
};
