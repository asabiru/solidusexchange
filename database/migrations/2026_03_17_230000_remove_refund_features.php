<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['exchange_requests', 'buy_requests', 'sell_requests'] as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'status')) {
                DB::table($table)->where('status', 6)->update(['status' => 5]);
            }
        }

        if (Schema::hasTable('exchange_payouts')) {
            DB::table('exchange_payouts')->where('type', 'refund')->delete();
        }

        if (Schema::hasTable('notification_templates')) {
            DB::table('notification_templates')
                ->whereIn('template_key', ['EXCHANGE_REFUND', 'BUY_REFUND', 'SELL_REFUND'])
                ->delete();
        }

        if (Schema::hasTable('basic_controls')) {
            Schema::table('basic_controls', function (Blueprint $table) {
                if (Schema::hasColumn('basic_controls', 'refund_exchange_status')) {
                    $table->dropColumn('refund_exchange_status');
                }
                if (Schema::hasColumn('basic_controls', 'refund_exchange_note')) {
                    $table->dropColumn('refund_exchange_note');
                }
            });
        }

        if (Schema::hasTable('exchange_requests') && Schema::hasColumn('exchange_requests', 'refund_wallet')) {
            Schema::table('exchange_requests', function (Blueprint $table) {
                $table->dropColumn('refund_wallet');
            });
        }

        if (Schema::hasTable('sell_requests') && Schema::hasColumn('sell_requests', 'refund_wallet')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                $table->dropColumn('refund_wallet');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('basic_controls')) {
            Schema::table('basic_controls', function (Blueprint $table) {
                if (!Schema::hasColumn('basic_controls', 'refund_exchange_status')) {
                    $table->tinyInteger('refund_exchange_status')->default(1)->comment('0=>inactive,1=>active');
                }
                if (!Schema::hasColumn('basic_controls', 'refund_exchange_note')) {
                    $table->text('refund_exchange_note')->nullable();
                }
            });
        }

        if (Schema::hasTable('exchange_requests') && !Schema::hasColumn('exchange_requests', 'refund_wallet')) {
            Schema::table('exchange_requests', function (Blueprint $table) {
                $table->string('refund_wallet')->nullable();
            });
        }

        if (Schema::hasTable('sell_requests') && !Schema::hasColumn('sell_requests', 'refund_wallet')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                $table->text('refund_wallet')->nullable();
            });
        }
    }
};
