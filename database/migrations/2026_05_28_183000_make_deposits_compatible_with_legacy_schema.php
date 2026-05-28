<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('deposits')) {
            return;
        }

        Schema::table('deposits', function (Blueprint $table) {
            if (!Schema::hasColumn('deposits', 'depositable_id')) {
                $table->unsignedBigInteger('depositable_id')->nullable();
            }

            if (!Schema::hasColumn('deposits', 'depositable_type')) {
                $table->string('depositable_type', 191)->nullable();
            }

            if (!Schema::hasColumn('deposits', 'user_id')) {
                $table->unsignedBigInteger('user_id')->nullable();
            }

            if (!Schema::hasColumn('deposits', 'payment_method_id')) {
                $table->unsignedBigInteger('payment_method_id')->nullable();
            }

            if (!Schema::hasColumn('deposits', 'payment_method_currency')) {
                $table->string('payment_method_currency', 20)->nullable();
            }

            if (!Schema::hasColumn('deposits', 'amount')) {
                $table->decimal('amount', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'charge_percentage')) {
                $table->decimal('charge_percentage', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'charge_fixed')) {
                $table->decimal('charge_fixed', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'charge')) {
                $table->decimal('charge', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'payable_amount')) {
                $table->decimal('payable_amount', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'payable_amount_base_currency')) {
                $table->decimal('payable_amount_base_currency', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'btc_amount')) {
                $table->decimal('btc_amount', 24, 8)->default(0);
            }

            if (!Schema::hasColumn('deposits', 'btc_wallet')) {
                $table->string('btc_wallet', 255)->nullable();
            }

            if (!Schema::hasColumn('deposits', 'information')) {
                $table->json('information')->nullable();
            }

            if (!Schema::hasColumn('deposits', 'trx_id')) {
                $table->string('trx_id', 191)->nullable();
            }

            if (!Schema::hasColumn('deposits', 'status')) {
                $table->tinyInteger('status')->default(0);
            }

            if (!Schema::hasColumn('deposits', 'note')) {
                $table->text('note')->nullable();
            }
        });

        DB::table('deposits')->update([
            'amount' => 0,
            'charge_percentage' => 0,
            'charge_fixed' => 0,
            'charge' => 0,
            'payable_amount' => 0,
            'payable_amount_base_currency' => 0,
            'btc_amount' => 0,
            'status' => 0,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('deposits')) {
            return;
        }

        Schema::table('deposits', function (Blueprint $table) {
            foreach ([
                'note',
                'status',
                'trx_id',
                'information',
                'btc_wallet',
                'btc_amount',
                'payable_amount_base_currency',
                'payable_amount',
                'charge',
                'charge_fixed',
                'charge_percentage',
                'amount',
                'payment_method_currency',
                'payment_method_id',
                'user_id',
                'depositable_type',
                'depositable_id',
            ] as $column) {
                if (Schema::hasColumn('deposits', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
