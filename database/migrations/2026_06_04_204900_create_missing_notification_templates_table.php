<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('notification_templates')) {
            return;
        }

        Schema::create('notification_templates', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('language_id')->nullable();
            $table->string('name')->nullable();
            $table->string('template_key')->nullable();
            $table->string('email_from')->nullable();
            $table->text('subject')->nullable();
            $table->text('short_keys')->nullable();
            $table->text('email')->nullable();
            $table->text('sms')->nullable();
            $table->text('in_app')->nullable();
            $table->text('push')->nullable();
            $table->string('status')->nullable();
            $table->boolean('notify_for')->default(false);
            $table->string('lang_code', 50)->nullable();
            $table->timestamps();

            $table->index('language_id');
            $table->index('notify_for');
            $table->index('template_key');
        });

        DB::table('notification_templates')->insert([
            [
                'id' => 11,
                'language_id' => 1,
                'name' => 'Support Ticket Create',
                'template_key' => 'SUPPORT_TICKET_CREATE',
                'email_from' => 'support@you.com',
                'subject' => 'Support Ticket New',
                'short_keys' => '{"ticket_id":"Support Ticket ID","username":"username"}',
                'email' => "[[username]] create a ticket\r\nTicket : [[ticket_id]]",
                'sms' => "[[username]] create a ticket\r\nTicket : [[ticket_id]]",
                'in_app' => "[[username]] create a ticket\r\nTicket : [[ticket_id]]",
                'push' => "[[username]] create a ticket\r\nTicket : [[ticket_id]]",
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 12,
                'language_id' => 1,
                'name' => 'Support Ticket Replied',
                'template_key' => 'SUPPORT_TICKET_REPLIED',
                'email_from' => 'support@you.com',
                'subject' => 'Support Ticket Replied',
                'short_keys' => '{"ticket_id":"Support Ticket ID","username":"username"}',
                'email' => "[[username]] replied ticket\r\nTicket : [[ticket_id]]",
                'sms' => "[[username]] replied ticket\r\nTicket : [[ticket_id]]",
                'in_app' => "[[username]] replied ticket\r\nTicket : [[ticket_id]]",
                'push' => "[[username]] replied ticket\r\nTicket : [[ticket_id]]",
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 17,
                'language_id' => 1,
                'name' => 'User Make Payment Admin',
                'template_key' => 'USER_MAKE_PAYMENT_ADMIN',
                'email_from' => 'support@you.com',
                'subject' => 'Make a Payment',
                'short_keys' => '{"user":"User","amount":"Amount","currency":"Currency","transaction":"Transaction Number"}',
                'email' => '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]',
                'sms' => '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]',
                'in_app' => '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]',
                'push' => '[[user]] make payment [[amount]] [[currency]]. Transaction [[transaction]]',
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 23,
                'language_id' => 1,
                'name' => 'Two Step Enabled',
                'template_key' => 'TWO_STEP_ENABLED',
                'email_from' => 'support@you.com',
                'subject' => 'TWO STEP ENABLED',
                'short_keys' => '{"action":"Enabled Or Disable","ip":"Device Ip","browser":"browser and Operating System ","time":"Time","code":"code"}',
                'email' => 'Your verification code is: {{code}}',
                'sms' => 'Your verification code is: {{code}}',
                'in_app' => 'Your verification code is: {{code}}',
                'push' => 'Your verification code is: {{code}}',
                'status' => '{"mail":"1","sms":"0","in_app":"0","push":"0"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 24,
                'language_id' => 1,
                'name' => 'Two Step Disabled',
                'template_key' => 'TWO_STEP_DISABLED',
                'email_from' => 'support@you.com',
                'short_keys' => '{"action":"Enabled Or Disable","ip":"Device Ip","browser":"browser and Operating System ","time":"Time"}',
                'email' => 'Google two factor verification is disabled',
                'sms' => 'Google two factor verification is disabled',
                'in_app' => 'Google two factor verification is disabled',
                'push' => 'Google two factor verification is disabled',
                'status' => '{"mail":"1","sms":"0","in_app":"0","push":"0"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 25,
                'language_id' => 1,
                'name' => 'Exchange Request',
                'template_key' => 'EXCHANGE_REQUEST',
                'email_from' => 'support@you.com',
                'subject' => 'You have a exchange request',
                'short_keys' => '{"user":"User","sendAmount":"Send Amount","getAmount":"Get Amount","sendCurrency":"Send Currency","getCurrency":"Get Currency","transaction":"Transaction"}',
                'email' => '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'sms' => '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'in_app' => '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'push' => '[[user]] make a exchange request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 26,
                'language_id' => 1,
                'name' => 'Buy Request',
                'template_key' => 'BUY_REQUEST',
                'email_from' => 'support@you.com',
                'subject' => 'You have a buy request',
                'short_keys' => '{"user":"User","sendAmount":"Send Amount","getAmount":"Get Amount","sendCurrency":"Send Currency","getCurrency":"Get Currency","transaction":"Transaction"}',
                'email' => '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'sms' => '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'in_app' => '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'push' => '[[user]] make a buy request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
            [
                'id' => 27,
                'language_id' => 1,
                'name' => 'Sell Request',
                'template_key' => 'SELL_REQUEST',
                'email_from' => 'support@you.com',
                'subject' => 'You have a sell request',
                'short_keys' => '{"user":"User","sendAmount":"Send Amount","getAmount":"Get Amount","sendCurrency":"Send Currency","getCurrency":"Get Currency","transaction":"Transaction"}',
                'email' => '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'sms' => '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'in_app' => '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'push' => '[[user]] make a sell request [[sendAmount]] [[sendCurrency]] to [[getAmount]] [[getCurrency]]. Transaction Id- [[transaction]]',
                'status' => '{"mail":"1","sms":"1","in_app":"1","push":"1"}',
                'notify_for' => 1,
                'lang_code' => 'en',
                'created_at' => '2021-08-02 18:05:43',
                'updated_at' => '2024-01-21 10:40:05',
            ],
        ]);
    }
};
