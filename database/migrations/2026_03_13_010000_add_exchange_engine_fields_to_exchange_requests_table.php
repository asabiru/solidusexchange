<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('exchange_requests')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            if (!Schema::hasColumn('exchange_requests', 'quote_provider')) {
                $table->string('quote_provider', 50)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_symbol')) {
                $table->string('quote_symbol', 50)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_reference_price')) {
                $table->decimal('quote_reference_price', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_price')) {
                $table->decimal('quote_price', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_markup_percent')) {
                $table->decimal('quote_markup_percent', 10, 4)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_slippage_percent')) {
                $table->decimal('quote_slippage_percent', 10, 4)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_trade_fee_percent')) {
                $table->decimal('quote_trade_fee_percent', 10, 4)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'quote_expires_at')) {
                $table->timestamp('quote_expires_at')->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_amount_confirmed')) {
                $table->decimal('deposit_amount_confirmed', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'deposit_tx_id')) {
                $table->string('deposit_tx_id', 191)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_status')) {
                $table->string('hedge_status', 50)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_order_id')) {
                $table->string('hedge_order_id', 191)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_order_link_id')) {
                $table->string('hedge_order_link_id', 191)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_avg_price')) {
                $table->decimal('hedge_avg_price', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_exec_qty')) {
                $table->decimal('hedge_exec_qty', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_exec_value')) {
                $table->decimal('hedge_exec_value', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_fee_amount')) {
                $table->decimal('hedge_fee_amount', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_fee_currency')) {
                $table->string('hedge_fee_currency', 50)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'profit_amount')) {
                $table->decimal('profit_amount', 30, 16)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'profit_currency')) {
                $table->string('profit_currency', 50)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'payout_tx_id')) {
                $table->string('payout_tx_id', 191)->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedge_error')) {
                $table->text('hedge_error')->nullable();
            }

            if (!Schema::hasColumn('exchange_requests', 'hedged_at')) {
                $table->timestamp('hedged_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('exchange_requests')) {
            return;
        }

        Schema::table('exchange_requests', function (Blueprint $table) {
            $columns = [
                'quote_provider',
                'quote_symbol',
                'quote_reference_price',
                'quote_price',
                'quote_markup_percent',
                'quote_slippage_percent',
                'quote_trade_fee_percent',
                'quote_expires_at',
                'deposit_amount_confirmed',
                'deposit_tx_id',
                'hedge_status',
                'hedge_order_id',
                'hedge_order_link_id',
                'hedge_avg_price',
                'hedge_exec_qty',
                'hedge_exec_value',
                'hedge_fee_amount',
                'hedge_fee_currency',
                'profit_amount',
                'profit_currency',
                'payout_tx_id',
                'hedge_error',
                'hedged_at',
            ];

            $existingColumns = array_filter($columns, static fn($column) => Schema::hasColumn('exchange_requests', $column));
            if ($existingColumns !== []) {
                $table->dropColumn($existingColumns);
            }
        });
    }
};
