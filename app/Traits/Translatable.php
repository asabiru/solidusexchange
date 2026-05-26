<?php


namespace App\Traits;

use App\Models\Language;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;

trait Translatable
{
    public static function booted()
    {
        if (Auth::getDefaultDriver() != 'admin') {
            $lang = app()->getLocale();

            $languageId = Language::where('short_name', $lang)->first();

            if (!$languageId){
                $languageId = Language::where('default_status', true)->first();
            }

            static::addGlobalScope('language', function (Builder $builder) use ($languageId) {
                if ($languageId) {
                    $builder->where('language_id', $languageId->id);
                }
            });
        }
    }
}
