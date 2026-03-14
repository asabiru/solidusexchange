<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('basic_controls')) {
            Schema::table('basic_controls', function (Blueprint $table) {
                if (!Schema::hasColumn('basic_controls', 'sumsub_enabled')) {
                    $table->unsignedTinyInteger('sumsub_enabled')->default(0);
                }
                if (!Schema::hasColumn('basic_controls', 'sumsub_app_token')) {
                    $table->string('sumsub_app_token')->nullable();
                }
                if (!Schema::hasColumn('basic_controls', 'sumsub_secret_key')) {
                    $table->text('sumsub_secret_key')->nullable();
                }
                if (!Schema::hasColumn('basic_controls', 'sumsub_base_url')) {
                    $table->string('sumsub_base_url')->nullable();
                }
                if (!Schema::hasColumn('basic_controls', 'sumsub_level_name')) {
                    $table->string('sumsub_level_name')->nullable();
                }
                if (!Schema::hasColumn('basic_controls', 'sumsub_websdk_url')) {
                    $table->string('sumsub_websdk_url')->nullable();
                }
            });
        }

        if (Schema::hasTable('kycs')) {
            Schema::table('kycs', function (Blueprint $table) {
                if (!Schema::hasColumn('kycs', 'provider')) {
                    $table->string('provider')->default('manual');
                }
                if (!Schema::hasColumn('kycs', 'provider_settings')) {
                    $table->json('provider_settings')->nullable();
                }
            });
        }

        if (Schema::hasTable('user_kycs')) {
            Schema::table('user_kycs', function (Blueprint $table) {
                if (!Schema::hasColumn('user_kycs', 'provider')) {
                    $table->string('provider')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_applicant_id')) {
                    $table->string('provider_applicant_id')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_review_status')) {
                    $table->string('provider_review_status')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_review_answer')) {
                    $table->string('provider_review_answer')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_payload')) {
                    $table->json('provider_payload')->nullable();
                }
                if (!Schema::hasColumn('user_kycs', 'provider_completed_at')) {
                    $table->timestamp('provider_completed_at')->nullable();
                }
            });
        }
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
