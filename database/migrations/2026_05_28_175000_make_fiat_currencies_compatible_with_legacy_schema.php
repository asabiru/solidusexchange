<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fiat_currencies')) {
            return;
        }

        Schema::table('fiat_currencies', function (Blueprint $table) {
            if (!Schema::hasColumn('fiat_currencies', 'usd_rate')) {
                $table->double('usd_rate')->default(1)->after('rate');
            }

            if (!Schema::hasColumn('fiat_currencies', 'rate_markup_percent')) {
                $table->decimal('rate_markup_percent', 8, 2)->default(0)->after('usd_rate');
            }

            if (!Schema::hasColumn('fiat_currencies', 'show_in_buy')) {
                $table->boolean('show_in_buy')->default(1)->after('status');
            }

            if (!Schema::hasColumn('fiat_currencies', 'show_in_sell')) {
                $table->boolean('show_in_sell')->default(1)->after('show_in_buy');
            }

            if (!Schema::hasColumn('fiat_currencies', 'buy_gateway_id')) {
                $table->unsignedBigInteger('buy_gateway_id')->nullable();
            }

            if (!Schema::hasColumn('fiat_currencies', 'fiat_send_gateway_id')) {
                $table->unsignedBigInteger('fiat_send_gateway_id')->nullable();
            }

            if (!Schema::hasColumn('fiat_currencies', 'sort_by')) {
                $table->unsignedInteger('sort_by')->default(0);
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('fiat_currencies')) {
            return;
        }

        Schema::table('fiat_currencies', function (Blueprint $table) {
            $dropColumns = [];
            foreach ([
                'sort_by',
                'fiat_send_gateway_id',
                'buy_gateway_id',
                'show_in_sell',
                'show_in_buy',
                'rate_markup_percent',
                'usd_rate',
            ] as $column) {
                if (Schema::hasColumn('fiat_currencies', $column)) {
                    $dropColumns[] = $column;
                }
            }

            if ($dropColumns !== []) {
                $table->dropColumn($dropColumns);
            }
        });
    }
};
