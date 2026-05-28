<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users') || Schema::hasColumn('users', 'username')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->string('username', 191)->nullable()->after('name');
        });

        $existingUsernames = DB::table('users')
            ->whereNotNull('username')
            ->pluck('username')
            ->map(fn ($value) => Str::lower(trim((string) $value)))
            ->filter()
            ->values()
            ->all();

        DB::table('users')
            ->select('id', 'name', 'email', 'username')
            ->orderBy('id')
            ->chunkById(200, function ($users) use (&$existingUsernames) {
                foreach ($users as $user) {
                    if (trim((string) ($user->username ?? '')) !== '') {
                        continue;
                    }

                    $baseName = '';
                    if (!empty($user->email) && str_contains($user->email, '@')) {
                        $baseName = Str::before($user->email, '@');
                    }
                    if ($baseName === '') {
                        $baseName = (string) ($user->name ?? '');
                    }
                    $baseName = Str::slug($baseName);
                    if ($baseName === '') {
                        $baseName = 'user';
                    }

                    $candidate = $baseName;
                    $suffix = 1;
                    while (in_array(Str::lower($candidate), $existingUsernames, true)) {
                        $candidate = $baseName . '-' . $suffix;
                        $suffix++;
                    }

                    DB::table('users')
                        ->where('id', $user->id)
                        ->update(['username' => $candidate]);

                    $existingUsernames[] = Str::lower($candidate);
                }
            }, 'id');

        Schema::table('users', function (Blueprint $table) {
            $table->unique('username', 'users_username_unique');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('users') || !Schema::hasColumn('users', 'username')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_username_unique');
            $table->dropColumn('username');
        });
    }
};
