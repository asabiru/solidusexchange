<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('wallet_pools')) {
            Schema::create('wallet_pools', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('type', 20)->default('hot');
                $table->string('currency_code', 20);
                $table->decimal('max_balance', 28, 8)->nullable();
                $table->decimal('min_balance', 28, 8)->nullable();
                $table->decimal('auto_sweep_threshold', 28, 8)->nullable();
                $table->string('signing_provider', 60)->default('manual');
                $table->string('status', 30)->default('active');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('custody_accounts')) {
            Schema::create('custody_accounts', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('currency_code', 20);
                $table->string('network', 40)->nullable();
                $table->decimal('available_balance', 28, 8)->default(0);
                $table->decimal('reserved_balance', 28, 8)->default(0);
                $table->string('status', 30)->default('active');
                $table->timestamps();

                $table->index(['user_id', 'currency_code']);
            });
        }

        if (!Schema::hasTable('custody_ledger_entries')) {
            Schema::create('custody_ledger_entries', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('custody_account_id')->nullable();
                $table->nullableMorphs('ledgerable');
                $table->string('entry_type', 40);
                $table->string('currency_code', 20);
                $table->decimal('amount', 28, 8);
                $table->decimal('balance_after', 28, 8)->nullable();
                $table->string('status', 30)->default('posted');
                $table->string('idempotency_key')->unique();
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->index(['custody_account_id', 'created_at']);
            });
        }

        if (!Schema::hasTable('custody_transfers')) {
            Schema::create('custody_transfers', function (Blueprint $table) {
                $table->id();
                $table->nullableMorphs('transferable');
                $table->unsignedBigInteger('from_account_id')->nullable();
                $table->unsignedBigInteger('to_account_id')->nullable();
                $table->string('currency_code', 20);
                $table->decimal('amount', 28, 8);
                $table->string('network', 40)->nullable();
                $table->string('tx_hash')->nullable();
                $table->string('status', 40)->default('pending');
                $table->string('provider', 60)->default('manual');
                $table->string('provider_reference')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('spread_rules')) {
            Schema::create('spread_rules', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('pair', 40)->nullable();
                $table->string('route', 40)->nullable();
                $table->string('source_channel', 40)->nullable();
                $table->decimal('min_amount', 28, 8)->nullable();
                $table->decimal('max_amount', 28, 8)->nullable();
                $table->decimal('markup_percent', 10, 6)->default(0);
                $table->decimal('slippage_percent', 10, 6)->default(0);
                $table->decimal('min_profit_percent', 10, 6)->default(0);
                $table->boolean('is_active')->default(true);
                $table->unsignedInteger('priority')->default(100);
                $table->json('conditions')->nullable();
                $table->timestamps();

                $table->index(['pair', 'is_active', 'priority']);
            });
        }

        if (!Schema::hasTable('quote_routes')) {
            Schema::create('quote_routes', function (Blueprint $table) {
                $table->id();
                $table->nullableMorphs('quotable');
                $table->string('pair', 40);
                $table->string('route', 40);
                $table->string('provider', 60)->nullable();
                $table->decimal('reference_price', 28, 12)->nullable();
                $table->decimal('client_price', 28, 12)->nullable();
                $table->decimal('markup_percent', 10, 6)->nullable();
                $table->decimal('slippage_percent', 10, 6)->nullable();
                $table->decimal('expected_profit_amount', 28, 8)->nullable();
                $table->string('profit_currency', 20)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('pnl_ledger')) {
            Schema::create('pnl_ledger', function (Blueprint $table) {
                $table->id();
                $table->nullableMorphs('pnlable');
                $table->string('currency_code', 20);
                $table->decimal('expected_amount', 28, 8)->nullable();
                $table->decimal('realized_amount', 28, 8)->nullable();
                $table->decimal('fee_amount', 28, 8)->nullable();
                $table->string('entry_type', 40);
                $table->json('metadata')->nullable();
                $table->timestamps();
            });
        }

        if (Schema::hasTable('exchange_wallets')) {
            Schema::table('exchange_wallets', function (Blueprint $table) {
                if (!Schema::hasColumn('exchange_wallets', 'pool_id')) {
                    $table->unsignedBigInteger('pool_id')->nullable()->index();
                }
                if (!Schema::hasColumn('exchange_wallets', 'wallet_type')) {
                    $table->string('wallet_type', 20)->default('hot')->index();
                }
                if (!Schema::hasColumn('exchange_wallets', 'last_sweep_at')) {
                    $table->timestamp('last_sweep_at')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('exchange_wallets')) {
            Schema::table('exchange_wallets', function (Blueprint $table) {
                $columns = ['pool_id', 'wallet_type', 'last_sweep_at'];
                $existing = array_values(array_filter($columns, fn(string $column) => Schema::hasColumn('exchange_wallets', $column)));
                if ($existing !== []) {
                    $table->dropColumn($existing);
                }
            });
        }

        Schema::dropIfExists('pnl_ledger');
        Schema::dropIfExists('quote_routes');
        Schema::dropIfExists('spread_rules');
        Schema::dropIfExists('custody_transfers');
        Schema::dropIfExists('custody_ledger_entries');
        Schema::dropIfExists('custody_accounts');
        Schema::dropIfExists('wallet_pools');
    }
};
