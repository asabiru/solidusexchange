<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'document_number')) {
            Schema::table('users', function (Blueprint $table) {
                $column = $table->string('document_number', 191)->nullable();

                if (Schema::hasColumn('users', 'phone')) {
                    $column->after('phone');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'document_number')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('document_number');
            });
        }
    }
};
