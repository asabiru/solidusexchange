<?php


namespace App\Traits;

use Carbon\Carbon;
use Illuminate\Support\Facades\Http;

trait TimeZone
{
    protected function localDateFormat($value)
    {
        if (isset($value)) {
            if (isset(auth()->user()->timezone)) {
                return Carbon::parse(Carbon::parse($value)->setTimezone(auth()->user()->timezone)->toDateTimeString());

            }
            return Carbon::parse($value);
        }
        return null;
    }
}
