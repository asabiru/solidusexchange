<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'telegram_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('telegram_id', 50)->nullable()->unique()->after('email');
                $table->string('telegram_username', 50)->nullable()->after('telegram_id');
            });
        }

        if (!Schema::hasTable('telegram_bots')) {
            Schema::create('telegram_bots', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('bot_token');
                $table->string('webhook_url')->nullable();
                $table->string('type')->default('general'); // general, support, mini_app
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('telegram_bot_chats')) {
            Schema::create('telegram_bot_chats', function (Blueprint $table) {
                $table->id();
                $table->foreignId('telegram_bot_id')->constrained('telegram_bots')->onDelete('cascade');
                $table->string('chat_id');
                $table->morphs('chatable'); // user or admin
                $table->string('username')->nullable();
                $table->string('first_name')->nullable();
                $table->string('last_name')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'telegram_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn(['telegram_id', 'telegram_username']);
            });
        }

        Schema::dropIfExists('telegram_bot_chats');
        Schema::dropIfExists('telegram_bots');
    }
};
