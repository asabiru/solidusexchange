<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('manage_menus')) {
            return;
        }

        Schema::table('manage_menus', function (Blueprint $table) {
            if (!Schema::hasColumn('manage_menus', 'menu_section')) {
                $table->string('menu_section')->nullable()->after('id');
            }

            if (!Schema::hasColumn('manage_menus', 'menu_items')) {
                $table->json('menu_items')->nullable()->after('menu_section');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('manage_menus')) {
            return;
        }

        Schema::table('manage_menus', function (Blueprint $table) {
            $dropColumns = [];

            foreach (['menu_section', 'menu_items'] as $column) {
                if (Schema::hasColumn('manage_menus', $column)) {
                    $dropColumns[] = $column;
                }
            }

            if ($dropColumns !== []) {
                $table->dropColumn($dropColumns);
            }
        });
    }
};
