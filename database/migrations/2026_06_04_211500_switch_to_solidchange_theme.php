<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $legacyTheme = implode('', ['li', 'ght']);

        if (Schema::hasTable('basic_controls')) {
            DB::table('basic_controls')->update([
                'theme' => 'solidchange',
                'default_mode' => 1,
                'changeable_mode' => 0,
            ]);
        }

        if (Schema::hasTable('pages')) {
            DB::table('pages')
                ->where('template_name', $legacyTheme)
                ->update(['template_name' => 'solidchange']);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('basic_controls')) {
            DB::table('basic_controls')->update([
                'theme' => 'solidchange',
                'default_mode' => 1,
                'changeable_mode' => 0,
            ]);
        }
    }
};
