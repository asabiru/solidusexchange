<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Sanctioned addresses — blacklist of crypto addresses from sanctions lists
        Schema::create('sanctioned_addresses', function (Blueprint $table) {
            $table->id();
            $table->string('address')->index();
            $table->string('currency_code', 20)->nullable()->index(); // BTC, ETH, TRX, etc. null = all chains
            $table->string('source', 50)->index(); // ofac, eu, uk, russia_cb, un, manual
            $table->string('entity_name')->nullable(); // e.g. "Garantex", "Suex", "Bitzlato"
            $table->string('entity_type', 30)->nullable(); // exchange, mixer, darknet, individual, terrorist
            $table->text('reason')->nullable();
            $table->string('list_date')->nullable(); // When added to sanctions list
            $table->enum('severity', ['blocked', 'high_risk', 'monitor'])->default('blocked');
            $table->enum('status', ['active', 'expired', 'revoked'])->default('active');
            $table->string('external_id')->nullable(); // ID in the source list
            $table->json('meta')->nullable();
            $table->timestamps();

            // Unique constraint: same address+source combination
            $table->unique(['address', 'source']);
        });

        // AML screening log — records every screening check
        Schema::create('aml_screening_logs', function (Blueprint $table) {
            $table->id();
            $table->string('screenable_type'); // CustodialDeposit, ExchangeRequest, etc.
            $table->unsignedBigInteger('screenable_id');
            $table->string('address')->index();
            $table->string('currency_code', 20);
            $table->string('provider', 50); // internal, ofac_api, chainalysis, etc.
            $table->enum('result', ['clean', 'match', 'partial_match', 'error'])->index();
            $table->string('matched_entity')->nullable();
            $table->string('matched_source', 50)->nullable();
            $table->decimal('risk_score', 5, 2)->default(0);
            $table->text('details')->nullable();
            $table->timestamp('checked_at');
            $table->timestamps();

            $table->index(['screenable_type', 'screenable_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aml_screening_logs');
        Schema::dropIfExists('sanctioned_addresses');
    }
};
