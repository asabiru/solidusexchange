<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
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
        DB::table('languages')
            ->where('short_name', 'ru')
            ->where('default_status', 0)
            ->delete();
    }
};
