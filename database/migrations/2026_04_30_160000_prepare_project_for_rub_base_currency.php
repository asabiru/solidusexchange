<?php

use App\Models\BasicControl;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration {
    public function up(): void
    {
        $basicControl = BasicControl::firstOrCreate();

        $basicControl->fill([
            'base_currency' => 'RUB',
            'currency_symbol' => '₽',
            'is_currency_position' => 'right',
            'has_space_between_currency_and_amount' => 1,
        ])->save();
    }

    public function down(): void
    {
    }
};
