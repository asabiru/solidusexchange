<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('basic_controls')) {
            return;
        }

        Schema::table('basic_controls', function (Blueprint $table) {
            if (!Schema::hasColumn('basic_controls', 'didit_enabled')) {
                $table->unsignedTinyInteger('didit_enabled')->default(0);
            }
            if (!Schema::hasColumn('basic_controls', 'didit_api_key')) {
                $table->text('didit_api_key')->nullable();
            }
            if (!Schema::hasColumn('basic_controls', 'didit_webhook_secret')) {
                $table->text('didit_webhook_secret')->nullable();
            }
            if (!Schema::hasColumn('basic_controls', 'didit_base_url')) {
                $table->string('didit_base_url')->nullable();
            }
            if (!Schema::hasColumn('basic_controls', 'didit_workflow_id')) {
                $table->string('didit_workflow_id')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('basic_controls', function (Blueprint $table) {
            $table->dropColumn([
                'didit_enabled',
                'didit_api_key',
                'didit_webhook_secret',
                'didit_base_url',
                'didit_workflow_id',
            ]);
        });
    }
};
