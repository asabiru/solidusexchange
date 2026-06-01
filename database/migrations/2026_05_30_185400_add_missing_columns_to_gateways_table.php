<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('gateways', function (Blueprint $table) {
            if (!Schema::hasColumn('gateways', 'code')) {
                $table->string('code')->after('id');
            }
            if (!Schema::hasColumn('gateways', 'name')) {
                $table->string('name')->after('code');
            }
            if (!Schema::hasColumn('gateways', 'image')) {
                $table->string('image')->nullable()->after('sort_by');
            }
            if (!Schema::hasColumn('gateways', 'driver')) {
                $table->string('driver', 20)->nullable()->after('image');
            }
            if (!Schema::hasColumn('gateways', 'parameters')) {
                $table->text('parameters')->nullable()->after('status');
            }
            if (!Schema::hasColumn('gateways', 'extra_parameters')) {
                $table->text('extra_parameters')->nullable()->after('currencies');
            }
            if (!Schema::hasColumn('gateways', 'description')) {
                $table->text('description')->nullable()->after('receivable_currencies');
            }
            if (!Schema::hasColumn('gateways', 'currency_type')) {
                $table->boolean('currency_type')->default(1)->after('description');
            }
            if (!Schema::hasColumn('gateways', 'is_manual')) {
                $table->boolean('is_manual')->default(1)->after('environment');
            }
        });
    }

    public function down(): void
    {
        Schema::table('gateways', function (Blueprint $table) {
            $cols = ['code', 'name', 'image', 'driver', 'parameters', 'extra_parameters', 'description', 'currency_type', 'is_manual'];
            foreach ($cols as $col) {
                if (Schema::hasColumn('gateways', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
