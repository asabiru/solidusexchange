<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('basic_controls', function (Blueprint $table) {
            $table->unsignedTinyInteger('sumsub_enabled')->default(0)->after('coin_market_cap_auto_update');
            $table->string('sumsub_app_token')->nullable()->after('sumsub_enabled');
            $table->text('sumsub_secret_key')->nullable()->after('sumsub_app_token');
            $table->string('sumsub_base_url')->nullable()->after('sumsub_secret_key');
            $table->string('sumsub_level_name')->nullable()->after('sumsub_base_url');
            $table->string('sumsub_websdk_url')->nullable()->after('sumsub_level_name');
        });

        Schema::table('kycs', function (Blueprint $table) {
            $table->string('provider')->default('manual')->after('slug');
            $table->json('provider_settings')->nullable()->after('provider');
        });

        Schema::table('user_kycs', function (Blueprint $table) {
            $table->string('provider')->nullable()->after('kyc_type');
            $table->string('provider_applicant_id')->nullable()->after('provider');
            $table->string('provider_review_status')->nullable()->after('provider_applicant_id');
            $table->string('provider_review_answer')->nullable()->after('provider_review_status');
            $table->json('provider_payload')->nullable()->after('provider_review_answer');
            $table->timestamp('provider_completed_at')->nullable()->after('provider_payload');
        });
    }

    public function down(): void
    {
        Schema::table('user_kycs', function (Blueprint $table) {
            $table->dropColumn([
                'provider',
                'provider_applicant_id',
                'provider_review_status',
                'provider_review_answer',
                'provider_payload',
                'provider_completed_at',
            ]);
        });

        Schema::table('kycs', function (Blueprint $table) {
            $table->dropColumn(['provider', 'provider_settings']);
        });

        Schema::table('basic_controls', function (Blueprint $table) {
            $table->dropColumn([
                'sumsub_enabled',
                'sumsub_app_token',
                'sumsub_secret_key',
                'sumsub_base_url',
                'sumsub_level_name',
                'sumsub_websdk_url',
            ]);
        });
    }
};
