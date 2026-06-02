<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('support_tickets', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->after('id');
            $table->string('ticket')->nullable()->after('user_id');
            $table->string('subject')->nullable()->after('ticket');
            $table->tinyInteger('status')->default(0)->after('subject');
            $table->timestamp('last_reply')->nullable()->after('status');
        });

        Schema::table('support_ticket_messages', function (Blueprint $table) {
            $table->unsignedBigInteger('support_ticket_id')->nullable()->after('id');
            $table->text('message')->nullable()->after('support_ticket_id');
        });

        Schema::table('support_ticket_attachments', function (Blueprint $table) {
            $table->unsignedBigInteger('support_ticket_message_id')->nullable()->after('id');
            $table->string('file')->nullable()->after('support_ticket_message_id');
            $table->string('driver')->default('local')->after('file');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('support_tickets', function (Blueprint $table) {
            $table->dropColumn(['user_id', 'ticket', 'subject', 'status', 'last_reply']);
        });

        Schema::table('support_ticket_messages', function (Blueprint $table) {
            $table->dropColumn(['support_ticket_id', 'message']);
        });

        Schema::table('support_ticket_attachments', function (Blueprint $table) {
            $table->dropColumn(['support_ticket_message_id', 'file', 'driver']);
        });
    }
};
