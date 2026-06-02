<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\WebhookController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

Route::any('deposit/webhook/{code}/{type?}', [WebhookController::class, 'webhookResponse'])->name('depositCallback');
Route::any('withdraw/webhook/{code?}/{utr?}/{type?}', [WebhookController::class, 'withdrawWebhookResponse'])->name('withdrawCallback');

Route::get('crypto-rates', function () {
    $rates = \App\Models\CryptoCurrency::where('status', 1)
        ->whereIn('code', ['BTC', 'ETH', 'USDT_TRC20', 'TON'])
        ->select('name', 'code', 'rate', 'usd_rate', 'change_24h', 'image', 'driver')
        ->get()
        ->map(function ($item) {
            $item->image = getFile($item->driver, $item->image);
            return $item;
        });
    return response()->json(['rates' => $rates]);
});


