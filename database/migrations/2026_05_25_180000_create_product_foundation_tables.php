<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('legal_documents')) {
            Schema::create('legal_documents', function (Blueprint $table) {
                $table->id();
                $table->string('type', 60);
                $table->string('version', 60);
                $table->string('locale', 10)->default('ru');
                $table->string('title');
                $table->longText('content')->nullable();
                $table->string('hash', 64)->unique();
                $table->timestamp('published_at')->nullable();
                $table->timestamps();

                $table->index(['type', 'locale', 'published_at']);
            });
        }

        if (!Schema::hasTable('consent_records')) {
            Schema::create('consent_records', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->nullableMorphs('consentable');
                $table->string('consent_type', 60);
                $table->unsignedBigInteger('legal_document_id')->nullable();
                $table->string('document_version', 60)->nullable();
                $table->string('document_hash', 64)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->json('metadata')->nullable();
                $table->timestamp('accepted_at');
                $table->timestamps();

                $table->index(['user_id', 'consent_type']);
                $table->index(['legal_document_id']);
            });
        }

        if (!Schema::hasTable('audit_logs')) {
            Schema::create('audit_logs', function (Blueprint $table) {
                $table->id();
                $table->nullableMorphs('auditable');
                $table->unsignedBigInteger('user_id')->nullable();
                $table->unsignedBigInteger('admin_id')->nullable();
                $table->string('action', 100);
                $table->json('old_values')->nullable();
                $table->json('new_values')->nullable();
                $table->json('metadata')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->string('idempotency_key')->nullable()->unique();
                $table->timestamps();

                $table->index(['user_id', 'action']);
                $table->index(['admin_id', 'action']);
            });
        }

        if (!Schema::hasTable('aml_checks')) {
            Schema::create('aml_checks', function (Blueprint $table) {
                $table->id();
                $table->nullableMorphs('checkable');
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('provider', 60)->default('manual');
                $table->string('provider_reference')->nullable();
                $table->string('status', 30)->default('pending');
                $table->string('risk_level', 30)->default('unknown');
                $table->decimal('risk_score', 8, 4)->nullable();
                $table->json('risk_categories')->nullable();
                $table->json('raw_response')->nullable();
                $table->text('notes')->nullable();
                $table->unsignedBigInteger('screened_by')->nullable();
                $table->timestamp('screened_at')->nullable();
                $table->timestamps();

                $table->index(['provider', 'status']);
                $table->index(['user_id', 'status']);
            });
        }

        if (!Schema::hasTable('deal_proofs')) {
            Schema::create('deal_proofs', function (Blueprint $table) {
                $table->id();
                $table->morphs('proofable');
                $table->unsignedBigInteger('uploaded_by_id')->nullable();
                $table->string('uploaded_by_type', 30)->nullable();
                $table->string('proof_type', 60)->default('payment_receipt');
                $table->string('file_path')->nullable();
                $table->string('file_driver', 40)->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();

                $table->index(['uploaded_by_id', 'uploaded_by_type']);
            });
        }

        if (!Schema::hasTable('deal_notes')) {
            Schema::create('deal_notes', function (Blueprint $table) {
                $table->id();
                $table->morphs('notable');
                $table->unsignedBigInteger('author_id')->nullable();
                $table->string('author_type', 30)->nullable();
                $table->text('message');
                $table->string('visibility', 30)->default('internal');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('disputes')) {
            Schema::create('disputes', function (Blueprint $table) {
                $table->id();
                $table->morphs('disputable');
                $table->unsignedBigInteger('opened_by_id')->nullable();
                $table->string('opened_by_type', 30)->nullable();
                $table->string('reason', 120);
                $table->string('status', 30)->default('opened');
                $table->text('resolution_notes')->nullable();
                $table->unsignedBigInteger('resolved_by_id')->nullable();
                $table->timestamp('resolved_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('trader_payment_accounts')) {
            Schema::create('trader_payment_accounts', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('admin_id');
                $table->string('bank_name')->nullable();
                $table->string('account_number')->nullable();
                $table->string('cardholder_name')->nullable();
                $table->string('phone_number')->nullable();
                $table->string('payment_system', 30)->default('bank_transfer');
                $table->string('currency_code', 20)->default('RUB');
                $table->decimal('daily_limit', 28, 8)->nullable();
                $table->decimal('current_daily_used', 28, 8)->default(0);
                $table->boolean('is_active')->default(true);
                $table->text('notes')->nullable();
                $table->timestamps();

                $table->index(['admin_id', 'is_active']);
            });
        }

        if (!Schema::hasTable('p2p_counterparties')) {
            Schema::create('p2p_counterparties', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('display_name')->nullable();
                $table->string('bank_details_hash')->nullable();
                $table->string('phone_hash')->nullable();
                $table->unsignedInteger('deal_count')->default(0);
                $table->unsignedInteger('successful_deal_count')->default(0);
                $table->boolean('flagged')->default(false);
                $table->boolean('blacklisted')->default(false);
                $table->decimal('trust_score', 8, 4)->nullable();
                $table->text('notes')->nullable();
                $table->timestamp('first_seen_at')->nullable();
                $table->timestamp('last_seen_at')->nullable();
                $table->timestamps();

                $table->index(['flagged', 'blacklisted']);
            });
        }

        if (!Schema::hasTable('trader_agreements')) {
            Schema::create('trader_agreements', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('admin_id');
                $table->unsignedBigInteger('legal_document_id')->nullable();
                $table->string('document_version', 60);
                $table->string('document_hash', 64);
                $table->string('ip_address', 45)->nullable();
                $table->text('user_agent')->nullable();
                $table->timestamp('accepted_at');
                $table->timestamps();

                $table->index(['admin_id', 'document_version']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('trader_agreements');
        Schema::dropIfExists('p2p_counterparties');
        Schema::dropIfExists('trader_payment_accounts');
        Schema::dropIfExists('disputes');
        Schema::dropIfExists('deal_notes');
        Schema::dropIfExists('deal_proofs');
        Schema::dropIfExists('aml_checks');
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('consent_records');
        Schema::dropIfExists('legal_documents');
    }
};
