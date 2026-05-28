<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'deleted_at')) {
                $table->softDeletes();
            }

            if (!Schema::hasColumn('users', 'firstname')) {
                $table->string('firstname', 255)->nullable()->after('username');
            }

            if (!Schema::hasColumn('users', 'lastname')) {
                $table->string('lastname', 255)->nullable()->after('firstname');
            }

            if (!Schema::hasColumn('users', 'email_verification')) {
                $table->tinyInteger('email_verification')->default(1)->after('password');
            }

            if (!Schema::hasColumn('users', 'sms_verification')) {
                $table->tinyInteger('sms_verification')->default(1)->after('email_verification');
            }

            if (!Schema::hasColumn('users', 'status')) {
                $table->tinyInteger('status')->default(1)->after('sms_verification');
            }

            if (!Schema::hasColumn('users', 'two_fa')) {
                $table->tinyInteger('two_fa')->default(0)->after('status');
            }

            if (!Schema::hasColumn('users', 'two_fa_verify')) {
                $table->tinyInteger('two_fa_verify')->default(1)->after('two_fa');
            }

            if (!Schema::hasColumn('users', 'last_login')) {
                $table->timestamp('last_login')->nullable()->after('two_fa_verify');
            }

            if (!Schema::hasColumn('users', 'last_seen')) {
                $table->timestamp('last_seen')->nullable()->after('last_login');
            }

            if (!Schema::hasColumn('users', 'phone_code')) {
                $table->string('phone_code', 20)->nullable()->after('lastname');
            }

            if (!Schema::hasColumn('users', 'phone')) {
                $table->string('phone', 50)->nullable()->after('phone_code');
            }

            if (!Schema::hasColumn('users', 'provider')) {
                $table->string('provider', 50)->nullable()->after('phone');
            }

            if (!Schema::hasColumn('users', 'provider_id')) {
                $table->string('provider_id', 191)->nullable()->after('provider');
            }

            if (!Schema::hasColumn('users', 'image_driver')) {
                $table->string('image_driver', 50)->nullable()->after('provider_id');
            }

            if (!Schema::hasColumn('users', 'image')) {
                $table->string('image', 191)->nullable()->after('image_driver');
            }

            if (!Schema::hasColumn('users', 'timezone')) {
                $table->string('timezone', 100)->nullable()->after('image');
            }

            if (!Schema::hasColumn('users', 'time_zone')) {
                $table->string('time_zone', 100)->nullable()->after('timezone');
            }

            if (!Schema::hasColumn('users', 'sent_at')) {
                $table->date('sent_at')->nullable()->after('time_zone');
            }

            if (!Schema::hasColumn('users', 'email_key')) {
                $table->json('email_key')->nullable()->after('sent_at');
            }

            if (!Schema::hasColumn('users', 'sms_key')) {
                $table->json('sms_key')->nullable()->after('email_key');
            }

            if (!Schema::hasColumn('users', 'push_key')) {
                $table->json('push_key')->nullable()->after('sms_key');
            }

            if (!Schema::hasColumn('users', 'in_app_key')) {
                $table->json('in_app_key')->nullable()->after('push_key');
            }

            if (!Schema::hasColumn('users', 'webhook_url')) {
                $table->json('webhook_url')->nullable()->after('in_app_key');
            }
        });

        $defaultTimezone = config('app.timezone', 'UTC');

        DB::table('users')->update(array_filter([
            'email_verification' => Schema::hasColumn('users', 'email_verification') ? 1 : null,
            'sms_verification' => Schema::hasColumn('users', 'sms_verification') ? 1 : null,
            'status' => Schema::hasColumn('users', 'status') ? 1 : null,
            'two_fa' => Schema::hasColumn('users', 'two_fa') ? 0 : null,
            'two_fa_verify' => Schema::hasColumn('users', 'two_fa_verify') ? 1 : null,
            'timezone' => Schema::hasColumn('users', 'timezone') ? $defaultTimezone : null,
            'time_zone' => Schema::hasColumn('users', 'time_zone') ? $defaultTimezone : null,
            'email_key' => Schema::hasColumn('users', 'email_key') ? json_encode([]) : null,
            'sms_key' => Schema::hasColumn('users', 'sms_key') ? json_encode([]) : null,
            'push_key' => Schema::hasColumn('users', 'push_key') ? json_encode([]) : null,
            'in_app_key' => Schema::hasColumn('users', 'in_app_key') ? json_encode([]) : null,
        ], static fn ($value) => $value !== null));
    }

    public function down(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            foreach ([
                'webhook_url',
                'in_app_key',
                'push_key',
                'sms_key',
                'email_key',
                'sent_at',
                'time_zone',
                'timezone',
                'image',
                'image_driver',
                'provider_id',
                'provider',
                'phone',
                'phone_code',
                'last_seen',
                'last_login',
                'two_fa_verify',
                'two_fa',
                'status',
                'sms_verification',
                'email_verification',
                'lastname',
                'firstname',
            ] as $column) {
                if (Schema::hasColumn('users', $column)) {
                    $table->dropColumn($column);
                }
            }

            if (Schema::hasColumn('users', 'deleted_at')) {
                $table->dropSoftDeletes();
            }
        });
    }
};
