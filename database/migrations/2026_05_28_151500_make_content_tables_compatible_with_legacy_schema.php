<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('contents')) {
            Schema::table('contents', function (Blueprint $table) {
                if (!Schema::hasColumn('contents', 'name')) {
                    $table->string('name')->nullable()->after('id');
                }

                if (!Schema::hasColumn('contents', 'type')) {
                    $table->string('type')->nullable()->after('name');
                }

                if (!Schema::hasColumn('contents', 'media')) {
                    $table->json('media')->nullable()->after('type');
                }
            });
        }

        if (Schema::hasTable('content_details')) {
            Schema::table('content_details', function (Blueprint $table) {
                if (!Schema::hasColumn('content_details', 'content_id')) {
                    $table->unsignedBigInteger('content_id')->nullable()->after('id');
                }

                if (!Schema::hasColumn('content_details', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable()->after('content_id');
                }

                if (!Schema::hasColumn('content_details', 'description')) {
                    $table->json('description')->nullable()->after('language_id');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('content_details')) {
            Schema::table('content_details', function (Blueprint $table) {
                $dropColumns = [];

                foreach (['content_id', 'language_id', 'description'] as $column) {
                    if (Schema::hasColumn('content_details', $column)) {
                        $dropColumns[] = $column;
                    }
                }

                if ($dropColumns !== []) {
                    $table->dropColumn($dropColumns);
                }
            });
        }

        if (Schema::hasTable('contents')) {
            Schema::table('contents', function (Blueprint $table) {
                $dropColumns = [];

                foreach (['name', 'type', 'media'] as $column) {
                    if (Schema::hasColumn('contents', $column)) {
                        $dropColumns[] = $column;
                    }
                }

                if ($dropColumns !== []) {
                    $table->dropColumn($dropColumns);
                }
            });
        }
    }
};
