<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Admin\Module\CryptoCurrencyController;
use App\Http\Controllers\Admin\Module\FiatCurrencyController;
use App\Http\Controllers\Admin\Module\CoinAnnounceController;
use App\Http\Controllers\Admin\Module\ExchangeController;
use App\Http\Controllers\Admin\Module\ExchangePayoutController;
use App\Http\Controllers\Admin\Module\BuyController;
use App\Http\Controllers\Admin\Module\SellController;
use App\Http\Controllers\Admin\Module\FiatSendGatewayController;

Route::group(['prefix' => 'admin', 'as' => 'admin.'], function () {
    Route::middleware(['auth:admin','verifyAdmin','adminRole:admin','demo'])->group(function () {

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

        Route::controller(ExchangeController::class)->group(function () {
            Route::get('exchange/list', 'exchangeList')->name('exchangeList');
            Route::get('exchange/list/search', 'exchangeListSearch')->name('exchangeListSearch');
            Route::get('exchange/view', 'exchangeView')->name('exchangeView');
            Route::get('exchange/rate-floating/{utr}', 'exchangeRateFloating')->name('exchangeRateFloating');
            Route::delete('exchange/delete/{id}', 'exchangeDelete')->name('exchangeDelete');
            Route::post('exchange/multiple-delete', 'exchangeMultipleDelete')->name('exchangeMultipleDelete');

            Route::post('exchange/confirm-deposit/{utr}', 'exchangeConfirmDeposit')->name('exchangeConfirmDeposit');
            Route::post('exchange/aml/approve/{id}', 'approveAml')->name('exchangeAmlApprove');
            Route::post('exchange/aml/reject/{id}', 'rejectAml')->name('exchangeAmlReject');
            Route::post('exchange/wallet-aml/approve/{id}', 'approveWalletAml')->name('exchangeWalletAmlApprove');
            Route::post('exchange/wallet-aml/reject/{id}', 'rejectWalletAml')->name('exchangeWalletAmlReject');
            Route::post('exchange/send-confirm/{utr}', 'exchangeSend')->name('exchangeSend');
            Route::post('exchange/cancel-confirm/{utr}', 'exchangeCancel')->name('exchangeCancel');
        });

        Route::controller(ExchangePayoutController::class)->group(function () {
            Route::get('exchange-payouts', 'index')->name('exchangePayoutIndex');
            Route::post('exchange-payouts/mark-sent/{id}', 'markSent')->name('exchangePayoutMarkSent');
            Route::post('exchange-payouts/mark-failed/{id}', 'markFailed')->name('exchangePayoutMarkFailed');
        });

        Route::controller(\App\Http\Controllers\Admin\Module\CustodialWalletController::class)->group(function () {
            Route::get('custodial/wallets', 'index')->name('custodialWalletIndex');
            Route::get('custodial/wallets/list', 'walletsList')->name('custodialWalletList');
            Route::post('custodial/wallets/generate', 'generateWallet')->name('custodialWalletGenerate');
            Route::post('custodial/wallets/freeze/{id}', 'freezeWallet')->name('custodialWalletFreeze');
            Route::post('custodial/wallets/release/{id}', 'releaseWallet')->name('custodialWalletRelease');
            Route::post('custodial/wallets/check-balance/{id}', 'checkWalletBalance')->name('custodialWalletCheckBalance');
            Route::post('custodial/wallets/refresh-balances', 'refreshBalances')->name('custodialWalletBalancesRefresh');
            Route::post('custodial/check-balances', 'checkAllBalances')->name('custodialCheckAllBalances');
            Route::get('custodial/deposits', 'depositsIndex')->name('custodialDepositIndex');
            Route::get('custodial/deposits/list', 'depositsList')->name('custodialDepositList');
            Route::post('custodial/deposits/approve/{id}', 'approveDeposit')->name('custodialDepositApprove');
            Route::post('custodial/deposits/reject/{id}', 'rejectDeposit')->name('custodialDepositReject');
            Route::post('custodial/scan-now', 'scanNow')->name('custodialScanNow');
            // Withdrawals
            Route::get('custodial/withdrawals', 'withdrawalsIndex')->name('custodialWithdrawals');
            Route::get('custodial/withdrawals/list', 'withdrawalsList')->name('custodialWithdrawalList');
            Route::get('custodial/withdrawals/create/{walletId}', 'createWithdrawal')->name('custodialWithdrawalCreate');
            Route::post('custodial/withdrawals/store', 'storeWithdrawal')->name('custodialWithdrawalStore');
            Route::post('custodial/withdrawals/approve/{id}', 'approveWithdrawal')->name('custodialWithdrawalApprove');
            Route::post('custodial/withdrawals/reject/{id}', 'rejectWithdrawal')->name('custodialWithdrawalReject');
            Route::post('custodial/withdrawals/execute/{id}', 'executeWithdrawal')->name('custodialWithdrawalExecute');
            Route::post('custodial/withdrawals/retry/{id}', 'retryWithdrawal')->name('custodialWithdrawalRetry');
        });

        Route::controller(\App\Http\Controllers\Admin\Module\SbpPaymentController::class)->group(function () {
            Route::get('sbp', 'index')->name('sbpIndex');
            Route::get('sbp/list', 'list')->name('sbpList');
            Route::get('sbp/confirm/{id}', 'confirm')->name('sbpConfirm');
            Route::get('sbp/reject/{id}', 'reject')->name('sbpReject');
            Route::get('sbp/settings', 'settings')->name('sbpSettings');
        });

        Route::controller(BuyController::class)->group(function () {
            Route::get('buy/list', 'buyList')->name('buyList');
            Route::get('buy/list/search', 'buyListSearch')->name('buyListSearch');
            Route::get('buy/view', 'buyView')->name('buyView');
            Route::post('buy/send-confirm/{utr}', 'buySend')->name('buySend');
            Route::post('buy/wallet-aml/approve/{id}', 'approveWalletAml')->name('buyWalletAmlApprove');
            Route::post('buy/wallet-aml/reject/{id}', 'rejectWalletAml')->name('buyWalletAmlReject');
            Route::post('buy/cancel-confirm/{utr}', 'buyCancel')->name('buyCancel');
        });

        Route::controller(SellController::class)->group(function () {
            Route::get('sell/list', 'sellList')->name('sellList');
            Route::get('sell/list/search', 'sellListSearch')->name('sellListSearch');
            Route::get('sell/view', 'sellView')->name('sellView');
            Route::post('sell/confirm-deposit/{utr}', 'sellConfirmDeposit')->name('sellConfirmDeposit');
            Route::post('sell/send-confirm/{utr}', 'sellSend')->name('sellSend');
            Route::post('sell/cancel-confirm/{utr}', 'sellCancel')->name('sellCancel');
        });

        Route::controller(FiatSendGatewayController::class)->group(function () {
            Route::get('fiat-send-gateway', 'index')->name('fiatSendGatewayIndex');
            Route::get('fiat-send-gateway/create', 'create')->name('fiatSendGatewayCreate');
            Route::post('fiat-send-gateway/store', 'store')->name('fiatSendGatewayStore');
            Route::get('fiat-send-gateway/edit/{id}', 'edit')->name('fiatSendGatewayEdit');
            Route::put('fiat-send-gateway/update/{id}', 'update')->name('fiatSendGatewayUpdate');
            Route::get('fiat-send-gateway/status/{id}', 'statusChange')->name('fiatSendGatewayStatus');
        });

    });
});
