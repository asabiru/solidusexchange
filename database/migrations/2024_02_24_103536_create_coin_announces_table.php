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
        Schema::create('coin_announces', function (Blueprint $table) {
            $table->id();
            $table->text('heading')->nullable();
            $table->text('description')->nullable();
            $table->text('image')->nullable();
            $table->string('driver')->nullable();
            $table->boolean('status')->default(1)->comment("0=>inactive,1=>active");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('coin_announces');
    }
};
