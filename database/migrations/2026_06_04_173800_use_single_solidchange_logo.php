<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('basic_controls')) {
            return;
        }

        $updates = [];
        foreach (['logo', 'dark_logo', 'favicon', 'admin_logo', 'admin_dark_mode_logo'] as $column) {
            if (Schema::hasColumn('basic_controls', $column)) {
                $updates[$column] = 'logo/solidchange-sc.png';
            }
        }

        foreach (['logo_driver', 'dark_logo_driver', 'favicon_driver', 'admin_logo_driver', 'admin_dark_mode_logo_driver'] as $column) {
            if (Schema::hasColumn('basic_controls', $column)) {
                $updates[$column] = 'local';
            }
        }

        if ($updates !== []) {
            DB::table('basic_controls')->update($updates);
        }
    }
};
