<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('languages')) {
            return;
        }

        if (!Schema::hasColumn('languages', 'short_name')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->string('short_name', 20)->nullable();
            });
        }

        if (!Schema::hasColumn('languages', 'name')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->string('name', 100)->nullable();
            });
        }

        if (!Schema::hasColumn('languages', 'flag')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->string('flag', 100)->nullable();
            });
        }

        if (!Schema::hasColumn('languages', 'flag_driver')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->string('flag_driver', 20)->nullable();
            });
        }

        if (!Schema::hasColumn('languages', 'status')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->tinyInteger('status')->default(1);
            });
        }

        if (!Schema::hasColumn('languages', 'rtl')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->tinyInteger('rtl')->default(0);
            });
        }

        if (!Schema::hasColumn('languages', 'default_status')) {
            Schema::table('languages', function (Blueprint $table) {
                $table->tinyInteger('default_status')->default(0);
            });
        }

        $languages = DB::table('languages')->select('id', 'name', 'short_name')->get();
        foreach ($languages as $language) {
            $updates = [];

            if (empty($language->short_name)) {
                $normalized = strtolower(trim((string) $language->name));
                $updates['short_name'] = match ($normalized) {
                    'english' => 'en',
                    'russian', 'русский' => 'ru',
                    default => $language->id == 1 ? 'en' : substr(preg_replace('/[^a-z]/', '', $normalized) ?: 'lg' . $language->id, 0, 3),
                };
            }

            if (empty($language->name)) {
                $shortName = $updates['short_name'] ?? $language->short_name;
                $updates['name'] = match ($shortName) {
                    'en' => 'English',
                    'ru' => 'Russian',
                    default => 'Language ' . $language->id,
                };
            }

            if ($updates !== []) {
                DB::table('languages')
                    ->where('id', $language->id)
                    ->update($updates);
            }
        }

        $existing = DB::table('languages')->where('short_name', 'ru')->first();

        $payload = [
            'name' => 'Russian',
            'short_name' => 'ru',
            'flag' => 'language/ru.svg',
            'flag_driver' => 'local',
            'status' => 1,
            'rtl' => 0,
            'default_status' => $existing->default_status ?? 0,
            'updated_at' => now(),
        ];

        if ($existing) {
            DB::table('languages')
                ->where('short_name', 'ru')
                ->update($payload);

            return;
        }

        $payload['created_at'] = now();

        DB::table('languages')->insert($payload);
    }

    public function down(): void
    {
        if (!Schema::hasTable('languages') || !Schema::hasColumn('languages', 'short_name')) {
            return;
        }

        DB::table('languages')
            ->where('short_name', 'ru')
            ->where('default_status', 0)
            ->delete();
    }
};
