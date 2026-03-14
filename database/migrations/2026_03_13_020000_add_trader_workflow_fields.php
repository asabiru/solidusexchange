<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('admins')) {
            Schema::table('admins', function (Blueprint $table) {
                if (!Schema::hasColumn('admins', 'role')) {
                    $table->string('role', 20)->default('admin')->after('status');
                }
            });
        }

        if (Schema::hasTable('fiat_send_gateways')) {
            Schema::table('fiat_send_gateways', function (Blueprint $table) {
                if (!Schema::hasColumn('fiat_send_gateways', 'processing_mode')) {
                    $table->string('processing_mode', 20)->default('manual')->after('driver');
                }
            });
        }

        if (Schema::hasTable('sell_requests')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                if (!Schema::hasColumn('sell_requests', 'assigned_trader_id')) {
                    $table->unsignedBigInteger('assigned_trader_id')->nullable()->after('crypto_method_id');
                }
                if (!Schema::hasColumn('sell_requests', 'assigned_at')) {
                    $table->timestamp('assigned_at')->nullable()->after('assigned_trader_id');
                }
                if (!Schema::hasColumn('sell_requests', 'completed_by_trader_id')) {
                    $table->unsignedBigInteger('completed_by_trader_id')->nullable()->after('assigned_at');
                }
                if (!Schema::hasColumn('sell_requests', 'completed_at')) {
                    $table->timestamp('completed_at')->nullable()->after('completed_by_trader_id');
                }
                if (!Schema::hasColumn('sell_requests', 'cancelled_by_trader_id')) {
                    $table->unsignedBigInteger('cancelled_by_trader_id')->nullable()->after('completed_at');
                }
                if (!Schema::hasColumn('sell_requests', 'cancelled_at')) {
                    $table->timestamp('cancelled_at')->nullable()->after('cancelled_by_trader_id');
                }
                if (!Schema::hasColumn('sell_requests', 'contact_telegram')) {
                    $table->string('contact_telegram', 255)->nullable()->after('refund_wallet');
                }
                if (!Schema::hasColumn('sell_requests', 'contact_telegram_id')) {
                    $table->string('contact_telegram_id', 255)->nullable()->after('contact_telegram');
                }
                if (!Schema::hasColumn('sell_requests', 'contact_telegram_source')) {
                    $table->string('contact_telegram_source', 50)->nullable()->after('contact_telegram_id');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('sell_requests')) {
            Schema::table('sell_requests', function (Blueprint $table) {
                $columns = [
                    'assigned_trader_id',
                    'assigned_at',
                    'completed_by_trader_id',
                    'completed_at',
                    'cancelled_by_trader_id',
                    'cancelled_at',
                    'contact_telegram',
                    'contact_telegram_id',
                    'contact_telegram_source',
                ];

                $existing = array_values(array_filter($columns, fn ($column) => Schema::hasColumn('sell_requests', $column)));
                if ($existing !== []) {
                    $table->dropColumn($existing);
                }
            });
        }

        if (Schema::hasTable('fiat_send_gateways') && Schema::hasColumn('fiat_send_gateways', 'processing_mode')) {
            Schema::table('fiat_send_gateways', function (Blueprint $table) {
                $table->dropColumn('processing_mode');
            });
        }

        if (Schema::hasTable('admins') && Schema::hasColumn('admins', 'role')) {
            Schema::table('admins', function (Blueprint $table) {
                $table->dropColumn('role');
            });
        }
    }
};
