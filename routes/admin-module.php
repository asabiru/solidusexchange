<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Admin\Module\CryptoCurrencyController;
use App\Http\Controllers\Admin\Module\FiatCurrencyController;
use App\Http\Controllers\Admin\Module\CoinAnnounceController;
use App\Http\Controllers\Admin\Module\CryptoMethodController;
use App\Http\Controllers\Admin\Module\ExchangeController;
use App\Http\Controllers\Admin\Module\ExchangePayoutController;
use App\Http\Controllers\Admin\Module\ExchangeWalletController;
use App\Http\Controllers\Admin\Module\BuyController;
use App\Http\Controllers\Admin\Module\SellController;
use App\Http\Controllers\Admin\Module\FiatSendGatewayController;

Route::group(['prefix' => 'admin', 'as' => 'admin.'], function () {
    Route::middleware(['auth:admin','adminRole:admin','demo'])->group(function () {

        Route::controller(CryptoCurrencyController::class)->group(function () {
            Route::get('crypto/list', 'cryptoList')->name('cryptoList');
            Route::get('crypto/list/search', 'cryptoListSearch')->name('cryptoListSearch');
            Route::any('crypto/create', 'cryptoCreate')->name('cryptoCreate');
            Route::any('crypto/edit', 'cryptoEdit')->name('cryptoEdit');
            Route::get('crypto/status-change', 'cryptoStatusChange')->name('cryptoStatusChange');
            Route::delete('crypto/delete/{id}', 'cryptoDelete')->name('cryptoDelete');
            Route::post('crypto/multiple-delete', 'cryptoMultipleDelete')->name('cryptoMultipleDelete');
            Route::post('crypto/multiple-status-change', 'cryptoMultipleStatusChange')->name('cryptoMultipleStatusChange');
            Route::post('crypto/multiple-rate-update', 'cryptoMultipleRateUpdate')->name('cryptoMultipleRateUpdate');
            Route::post('crypto/sort', 'cryptoSort')->name('cryptoSort');
        });

        Route::controller(FiatCurrencyController::class)->group(function () {
            Route::get('fiat/list', 'fiatList')->name('fiatList');
            Route::get('fiat/list/search', 'fiatListSearch')->name('fiatListSearch');
            Route::any('fiat/create', 'fiatCreate')->name('fiatCreate');
            Route::any('fiat/edit', 'fiatEdit')->name('fiatEdit');
            Route::get('fiat/status-change', 'fiatStatusChange')->name('fiatStatusChange');
            Route::delete('fiat/delete/{id}', 'fiatDelete')->name('fiatDelete');
            Route::post('fiat/multiple-delete', 'fiatMultipleDelete')->name('fiatMultipleDelete');
            Route::post('fiat/multiple-status-change', 'fiatMultipleStatusChange')->name('fiatMultipleStatusChange');
            Route::post('fiat/multiple-rate-update', 'fiatMultipleRateUpdate')->name('fiatMultipleRateUpdate');
            Route::post('fiat/sort', 'fiatSort')->name('fiatSort');
        });

        Route::controller(CoinAnnounceController::class)->group(function () {
            Route::get('coin-announce/list', 'coinAnnounceList')->name('coinAnnounceList');
            Route::get('coin-announce/list/search', 'coinAnnounceSearch')->name('coinAnnounceSearch');
            Route::any('coin-announce/create', 'coinAnnounceCreate')->name('coinAnnounceCreate');
            Route::any('coin-announce/edit', 'coinAnnounceEdit')->name('coinAnnounceEdit');
            Route::get('coin-announce/status-change', 'coinAnnounceStatusChange')->name('coinAnnounceStatusChange');
            Route::delete('coin-announce/delete/{id}', 'coinAnnounceDelete')->name('coinAnnounceDelete');
            Route::post('coin-announce/multiple-delete', 'coinAnnounceMultipleDelete')->name('coinAnnounceMultipleDelete');
            Route::post('coin-announce/multiple-status-change', 'coinAnnounceMultipleStatusChange')->name('coinAnnounceMultipleStatusChange');
        });

        Route::controller(CryptoMethodController::class)->group(function () {
            Route::get('crypto-method/list', 'cryptoMethodList')->name('cryptoMethodList');
            Route::get('crypto-method/list/search', 'cryptoMethodSearch')->name('cryptoMethodSearch');
            Route::any('crypto-method/edit', 'cryptoMethodEdit')->name('cryptoMethodEdit');
            Route::any('crypto-method/manual/set-address', 'cryptoMethodSetAddress')->name('cryptoMethodSetAddress');
            Route::get('crypto-method/status-change', 'cryptoMethodStatusChange')->name('cryptoMethodStatusChange');
        });

        Route::controller(ExchangeController::class)->group(function () {
            Route::get('exchange/list', 'exchangeList')->name('exchangeList');
            Route::get('exchange/list/search', 'exchangeListSearch')->name('exchangeListSearch');
            Route::get('exchange/view', 'exchangeView')->name('exchangeView');
            Route::get('exchange/rate-floating/{utr}', 'exchangeRateFloating')->name('exchangeRateFloating');
            Route::delete('exchange/delete/{id}', 'exchangeDelete')->name('exchangeDelete');
            Route::post('exchange/multiple-delete', 'exchangeMultipleDelete')->name('exchangeMultipleDelete');

            Route::post('exchange/confirm-deposit/{utr}', 'exchangeConfirmDeposit')->name('exchangeConfirmDeposit');
            Route::post('exchange/send-confirm/{utr}', 'exchangeSend')->name('exchangeSend');
            Route::post('exchange/cancel-confirm/{utr}', 'exchangeCancel')->name('exchangeCancel');
        });

        Route::controller(ExchangeWalletController::class)->group(function () {
            Route::get('exchange-wallets', 'index')->name('exchangeWalletIndex');
            Route::get('exchange-wallets/create', 'create')->name('exchangeWalletCreate');
            Route::post('exchange-wallets/store', 'store')->name('exchangeWalletStore');
            Route::get('exchange-wallets/edit/{id}', 'edit')->name('exchangeWalletEdit');
            Route::put('exchange-wallets/update/{id}', 'update')->name('exchangeWalletUpdate');
            Route::post('exchange-wallets/sync/{id}', 'sync')->name('exchangeWalletSync');
            Route::delete('exchange-wallets/delete/{id}', 'delete')->name('exchangeWalletDelete');
        });

        Route::controller(ExchangePayoutController::class)->group(function () {
            Route::get('exchange-payouts', 'index')->name('exchangePayoutIndex');
            Route::post('exchange-payouts/mark-sent/{id}', 'markSent')->name('exchangePayoutMarkSent');
            Route::post('exchange-payouts/mark-failed/{id}', 'markFailed')->name('exchangePayoutMarkFailed');
        });

        Route::controller(BuyController::class)->group(function () {
            Route::get('buy/list', 'buyList')->name('buyList');
            Route::get('buy/list/search', 'buyListSearch')->name('buyListSearch');
            Route::get('buy/view', 'buyView')->name('buyView');
            Route::delete('buy/delete/{id}', 'buyDelete')->name('buyDelete');
            Route::post('buy/multiple-delete', 'buyMultipleDelete')->name('buyMultipleDelete');

            Route::post('buy/send-confirm/{utr}', 'buySend')->name('buySend');
            Route::post('buy/cancel-confirm/{utr}', 'buyCancel')->name('buyCancel');
        });

        Route::controller(SellController::class)->group(function () {
            Route::get('sell/list', 'sellList')->name('sellList');
            Route::get('sell/list/search', 'sellListSearch')->name('sellListSearch');
            Route::get('sell/view', 'sellView')->name('sellView');
            Route::delete('sell/delete/{id}', 'sellDelete')->name('sellDelete');
            Route::post('sell/multiple-delete', 'sellMultipleDelete')->name('sellMultipleDelete');

            Route::post('sell/send-confirm/{utr}', 'sellSend')->name('sellSend');
            Route::post('sell/cancel-confirm/{utr}', 'sellCancel')->name('sellCancel');
        });

        Route::controller(FiatSendGatewayController::class)->group(function () {
            Route::get('fiat-send-gateway', 'index')->name('fiatSendGatewayIndex');
            Route::get('fiat-send-gateway/create', 'create')->name('fiatSendGatewayCreate');
            Route::post('fiat-send-gateway/store', 'store')->name('fiatSendGatewayStore');
            Route::get('fiat-send-gateway/edit/{id}', 'edit')->name('fiatSendGatewayEdit');
            Route::put('fiat-send-gateway/update/{id}', 'update')->name('fiatSendGatewayUpdate');
            Route::post('fiat-send-gateway/status-change', 'statusChange')->name('fiatSendGatewayStatusChange');
        });
    });
});




// Custodial Wallets & Withdrawals (2FA required on execute/approve)
Route::group(['prefix' => 'admin', 'as' => 'admin.', 'middleware' => ['auth:admin', 'verifyAdmin', 'demo', 'adminRole:admin']], function () {
    Route::controller(\App\Http\Controllers\Admin\Module\CustodialWalletController::class)->group(function () {
        Route::get('custodial-wallets', 'index')->name('custodialWallets');
        Route::post('custodial-wallets/list', 'walletsList')->name('custodialWalletsList');
        Route::get('custodial-wallets/deposits', 'depositsIndex')->name('custodialDeposits');
        Route::post('custodial-wallets/deposits/list', 'depositsList')->name('custodialDepositsList');
        Route::get('custodial-wallets/withdrawals', 'withdrawalsIndex')->name('custodialWithdrawals');
        Route::post('custodial-wallets/withdrawals/list', 'withdrawalsList')->name('custodialWithdrawalsList');
        Route::get('custodial-wallets/{id}/withdraw', 'createWithdrawal')->name('custodialWithdrawalCreate');
        Route::post('custodial-wallets/withdrawal/store', 'storeWithdrawal')->name('custodialWithdrawalStore');

        // Approve and Execute require 2FA
        Route::post('custodial-wallets/withdrawal/{id}/approve', 'approveWithdrawal')
            ->middleware('require2fa.withdraw')
            ->name('custodialWithdrawalApprove');
        Route::post('custodial-wallets/withdrawal/{id}/execute', 'executeWithdrawal')
            ->middleware('require2fa.withdraw')
            ->name('custodialWithdrawalExecute');
        Route::post('custodial-wallets/withdrawal/{id}/reject', 'rejectWithdrawal')->name('custodialWithdrawalReject');
        Route::post('custodial-wallets/withdrawal/{id}/retry', 'retryWithdrawal')->name('custodialWithdrawalRetry');
    });
});
