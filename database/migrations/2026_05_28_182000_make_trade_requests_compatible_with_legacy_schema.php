<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('buy_requests')) {
            Schema::table('buy_requests', function (Blueprint $table) {
                if (!Schema::hasColumn('buy_requests', 'utr')) {
                    $table->string('utr', 50)->nullable()->after('status')->index();
                }

                if (!Schema::hasColumn('buy_requests', 'gateway_id')) {
                    $table->unsignedBigInteger('gateway_id')->nullable();
                }

                if (!Schema::hasColumn('buy_requests', 'expire_time')) {
                    $table->timestamp('expire_time')->nullable();
                }
            });
        }

        if (Schema::hasTable('sell_requests')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                if (!Schema::hasColumn('sell_requests', 'utr')) {
                    $table->string('utr', 50)->nullable()->after('status')->index();
                }

                if (!Schema::hasColumn('sell_requests', 'expire_time')) {
                    $table->timestamp('expire_time')->nullable();
                }
            });
        }

        if (Schema::hasTable('exchange_requests')) {
            Schema::table('exchange_requests', function (Blueprint $table) {
                if (!Schema::hasColumn('exchange_requests', 'utr')) {
                    $table->string('utr', 50)->nullable()->after('status')->index();
                }

                if (!Schema::hasColumn('exchange_requests', 'crypto_method_id')) {
                    $table->unsignedBigInteger('crypto_method_id')->nullable()->after('get_currency_id');
                }

                if (!Schema::hasColumn('exchange_requests', 'rate_type')) {
                    $table->string('rate_type', 20)->nullable();
                }

                if (!Schema::hasColumn('exchange_requests', 'admin_wallet')) {
                    $table->string('admin_wallet', 255)->nullable();
                }

                if (!Schema::hasColumn('exchange_requests', 'destination_wallet')) {
                    $table->string('destination_wallet', 255)->nullable();
                }

                if (!Schema::hasColumn('exchange_requests', 'expire_time')) {
                    $table->timestamp('expire_time')->nullable();
                }

                if (!Schema::hasColumn('exchange_requests', 'deleted_at')) {
                    $table->softDeletes();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('exchange_requests')) {
            Schema::table('exchange_requests', function (Blueprint $table) {
                foreach (['deleted_at', 'expire_time', 'destination_wallet', 'admin_wallet', 'rate_type', 'crypto_method_id', 'utr'] as $column) {
                    if (Schema::hasColumn('exchange_requests', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('sell_requests')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                foreach (['expire_time', 'utr'] as $column) {
                    if (Schema::hasColumn('sell_requests', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('buy_requests')) {
            Schema::table('buy_requests', function (Blueprint $table) {
                foreach (['expire_time', 'gateway_id', 'utr'] as $column) {
                    if (Schema::hasColumn('buy_requests', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
