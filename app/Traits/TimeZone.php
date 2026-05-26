<?php


namespace App\Traits;

use Carbon\Carbon;
use Illuminate\Support\Facades\Http;

trait TimeZone
{
    protected function localDateFormat($value)
    {
        if (isset($value)) {
            $timezone = auth()->user()->timezone ?? optional(basicControl())->time_zone ?? config('app.timezone');

            if (!empty($timezone)) {
                return Carbon::parse(Carbon::parse($value)->setTimezone($timezone)->toDateTimeString());

            }
            return Carbon::parse($value);
        }
        return null;
    }
}
