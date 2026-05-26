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
        Schema::create('crypto_methods', function (Blueprint $table) {
            $table->id();
            $table->string('code')->nullable();
            $table->string('name')->nullable();
            $table->text('image')->nullable();
            $table->string('driver')->nullable();
            $table->text('parameters')->nullable();
            $table->text('extra_parameters')->nullable();
            $table->text('description')->nullable();
            $table->boolean('status')->default(0)->comment("0=>inactive,1=>active");
            $table->boolean('is_automatic')->default(1)->comment("0=>manual,1=>automatic");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('crypto_methods');
    }
};
