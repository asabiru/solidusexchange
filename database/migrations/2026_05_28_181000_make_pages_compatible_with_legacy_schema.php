<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('pages')) {
            Schema::table('pages', function (Blueprint $table) {
                if (!Schema::hasColumn('pages', 'slug')) {
                    $table->string('slug', 191)->nullable();
                }

                if (!Schema::hasColumn('pages', 'name')) {
                    $table->string('name', 191)->nullable();
                }

                if (!Schema::hasColumn('pages', 'template_name')) {
                    $table->string('template_name', 50)->nullable();
                }

                if (!Schema::hasColumn('pages', 'type')) {
                    $table->tinyInteger('type')->default(0);
                }

                if (!Schema::hasColumn('pages', 'status')) {
                    $table->tinyInteger('status')->default(1);
                }

                if (!Schema::hasColumn('pages', 'custom_link')) {
                    $table->string('custom_link', 255)->nullable();
                }

                if (!Schema::hasColumn('pages', 'page_title')) {
                    $table->string('page_title', 191)->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_title')) {
                    $table->string('meta_title', 191)->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_keywords')) {
                    $table->text('meta_keywords')->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_description')) {
                    $table->text('meta_description')->nullable();
                }

                if (!Schema::hasColumn('pages', 'og_description')) {
                    $table->text('og_description')->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_robots')) {
                    $table->text('meta_robots')->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_image_driver')) {
                    $table->string('meta_image_driver', 50)->nullable();
                }

                if (!Schema::hasColumn('pages', 'meta_image')) {
                    $table->string('meta_image', 255)->nullable();
                }

                if (!Schema::hasColumn('pages', 'breadcrumb_status')) {
                    $table->tinyInteger('breadcrumb_status')->default(0);
                }

                if (!Schema::hasColumn('pages', 'breadcrumb_image_driver')) {
                    $table->string('breadcrumb_image_driver', 50)->nullable();
                }

                if (!Schema::hasColumn('pages', 'breadcrumb_image')) {
                    $table->string('breadcrumb_image', 255)->nullable();
                }
            });
        }

        if (Schema::hasTable('page_details')) {
            Schema::table('page_details', function (Blueprint $table) {
                if (!Schema::hasColumn('page_details', 'page_id')) {
                    $table->unsignedBigInteger('page_id')->nullable();
                }

                if (!Schema::hasColumn('page_details', 'language_id')) {
                    $table->unsignedBigInteger('language_id')->nullable();
                }

                if (!Schema::hasColumn('page_details', 'name')) {
                    $table->string('name', 191)->nullable();
                }

                if (!Schema::hasColumn('page_details', 'content')) {
                    $table->longText('content')->nullable();
                }

                if (!Schema::hasColumn('page_details', 'sections')) {
                    $table->json('sections')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('page_details')) {
            Schema::table('page_details', function (Blueprint $table) {
                foreach (['sections', 'content', 'name', 'language_id', 'page_id'] as $column) {
                    if (Schema::hasColumn('page_details', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('pages')) {
            Schema::table('pages', function (Blueprint $table) {
                foreach ([
                    'breadcrumb_image',
                    'breadcrumb_image_driver',
                    'breadcrumb_status',
                    'meta_image',
                    'meta_image_driver',
                    'meta_robots',
                    'og_description',
                    'meta_description',
                    'meta_keywords',
                    'meta_title',
                    'page_title',
                    'custom_link',
                    'status',
                    'type',
                    'template_name',
                    'name',
                    'slug',
                ] as $column) {
                    if (Schema::hasColumn('pages', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
