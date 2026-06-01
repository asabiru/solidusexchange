<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('gateways', function (Blueprint $table) {
            if (!Schema::hasColumn('gateways', 'status')) {
                $table->boolean('status')->default(1)->comment('0: inactive, 1: active');
            }
        });
    }

    public function down(): void
    {
        Schema::table('gateways', function (Blueprint $table) {
            if (Schema::hasColumn('gateways', 'status')) {
                $table->dropColumn('status');
            }
        });
    }
};
