<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('basic_controls')) {
            return;
        }

        Schema::table('basic_controls', function (Blueprint $table) {
            if (!Schema::hasColumn('basic_controls', 'theme')) {
                $table->string('theme', 50)->nullable()->default('light');
            }
            if (!Schema::hasColumn('basic_controls', 'site_title')) {
                $table->string('site_title', 255)->nullable()->default('SolidChange');
            }
            if (!Schema::hasColumn('basic_controls', 'time_zone')) {
                $table->string('time_zone', 100)->nullable();
            }
            if (!Schema::hasColumn('basic_controls', 'base_currency')) {
                $table->string('base_currency', 10)->nullable()->default('RUB');
            }
            if (!Schema::hasColumn('basic_controls', 'currency_symbol')) {
                $table->string('currency_symbol', 10)->nullable()->default('₽');
            }
            if (!Schema::hasColumn('basic_controls', 'is_currency_position')) {
                $table->string('is_currency_position', 20)->nullable()->default('right');
            }
            if (!Schema::hasColumn('basic_controls', 'has_space_between_currency_and_amount')) {
                $table->boolean('has_space_between_currency_and_amount')->default(1);
            }
            if (!Schema::hasColumn('basic_controls', 'paginate')) {
                $table->unsignedInteger('paginate')->default(15);
            }
            if (!Schema::hasColumn('basic_controls', 'registration')) {
                $table->boolean('registration')->default(1);
            }
            if (!Schema::hasColumn('basic_controls', 'fraction_number')) {
                $table->unsignedTinyInteger('fraction_number')->default(2);
            }
            if (!Schema::hasColumn('basic_controls', 'date_time_format')) {
                $table->string('date_time_format', 50)->default('d/m/Y H:i');
            }
            if (!Schema::hasColumn('basic_controls', 'default_mode')) {
                $table->boolean('default_mode')->default(0);
            }
            if (!Schema::hasColumn('basic_controls', 'changeable_mode')) {
                $table->boolean('changeable_mode')->default(1);
            }
        });

        DB::table('basic_controls')->update([
            'theme' => 'light',
            'site_title' => 'SolidChange',
            'time_zone' => config('app.timezone', 'UTC'),
            'base_currency' => 'RUB',
            'currency_symbol' => '₽',
            'is_currency_position' => 'right',
            'has_space_between_currency_and_amount' => 1,
            'paginate' => 15,
            'registration' => 1,
            'fraction_number' => 2,
            'date_time_format' => 'd/m/Y H:i',
            'default_mode' => 0,
            'changeable_mode' => 1,
        ]);
    }

    public function down(): void
    {
        if (!Schema::hasTable('basic_controls')) {
            return;
        }

        Schema::table('basic_controls', function (Blueprint $table) {
            foreach ([
                'changeable_mode',
                'default_mode',
                'date_time_format',
                'fraction_number',
                'registration',
                'paginate',
                'has_space_between_currency_and_amount',
                'is_currency_position',
                'currency_symbol',
                'base_currency',
                'time_zone',
                'site_title',
                'theme',
            ] as $column) {
                if (Schema::hasColumn('basic_controls', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
