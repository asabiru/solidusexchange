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
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->text('announcement_text')->nullable();
            $table->string('btn_name')->nullable();
            $table->text('btn_link')->nullable();
            $table->boolean('btn_display')->default(0)->comment("0=>off,1=>on");
            $table->boolean('status')->default(0)->comment("0=>off,1=>on");
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('announcements');
    }
};
