<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\DiditWebhookController;
use App\Http\Controllers\SumsubWebhookController;
use App\Http\Controllers\TatumWebhookController;
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
Route::post('kyc/sumsub/webhook', SumsubWebhookController::class)->name('sumsub.webhook');
Route::post('kyc/didit/webhook', DiditWebhookController::class)->name('didit.webhook');

// Tatum.io blockchain notification webhook
Route::post('tatum/webhook', [TatumWebhookController::class, 'handle'])->name('tatum.webhook');

