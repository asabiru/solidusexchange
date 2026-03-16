<?php

use App\Http\Controllers\Auth\LoginController as UserLoginController;
use App\Http\Controllers\FrontendController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\User\HomeController;
use App\Http\Controllers\User\DepositController;
use App\Http\Controllers\ManualRecaptchaController;
use App\Http\Controllers\khaltiPaymentController;
use App\Models\Language;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\InAppNotificationController;
use App\Http\Controllers\User\SupportController;
use App\Http\Controllers\Auth\ForgotPasswordController;
use App\Http\Controllers\Auth\ResetPasswordController;
use App\Http\Controllers\User\VerificationController;
use App\Http\Controllers\FaSecurityController;
use App\Http\Controllers\User\UserProfileController;
use App\Http\Controllers\SocialiteController;

$basicControl = basicControl();


Route::get('maintenance-mode', function () {
    if (!basicControl()->is_maintenance_mode) {
        return redirect(route('page'));
    }
    $data['maintenanceMode'] = \App\Models\MaintenanceMode::first();
    return view(template() . 'maintenance', $data);
})->name('maintenance');

Route::get('password/reset', [ForgotPasswordController::class, 'showLinkRequestForm'])->name('password.request');
Route::post('password/email', [ForgotPasswordController::class, 'sendResetLinkEmail'])->name('password.email');
Route::get('password/reset/{token}', [ResetPasswordController::class, 'showResetForm'])->name('password.reset')->middleware('guest');
Route::post('password/reset', [ResetPasswordController::class, 'reset'])->name('password.reset.update');
    Route::get('instruction/page', function () {
        return view('instruction-page');
    })->name('instructionPage');

    Route::get('license', function () {
        return redirect()->route('page');
    })->name('license.redirect');


Route::group(['middleware' => ['maintenanceMode']], function () use ($basicControl) {
    Route::group(['middleware' => ['guest']], function () {
        Route::get('/login', [UserLoginController::class, 'showLoginForm'])->name('login');
        Route::post('/login', [UserLoginController::class, 'login'])->name('login.submit');
    });

    Route::get('check', [VerificationController::class, 'check'])->name('check');
    Route::get('resend_code', [VerificationController::class, 'resendCode'])->name('user.resendCode');
    Route::post('mail-verify', [VerificationController::class, 'mailVerify'])->name('user.mailVerify');
    Route::post('sms-verify', [VerificationController::class, 'smsVerify'])->name('user.smsVerify');
    Route::post('twoFA-Verify', [VerificationController::class, 'twoFAverify'])->name('user.twoFA-Verify');

    Route::group(['middleware' => ['auth', 'verifyUser'], 'prefix' => 'user', 'as' => 'user.'], function () {

        Route::controller(HomeController::class)->group(function () {
            Route::get('dashboard', 'index')->name('dashboard');
            Route::post('save-token', 'saveToken')->name('save.token');

            Route::get('kyc/{slug}/{id}', 'kycShow')->name('kyc');
            Route::post('kyc/submit/{id}', 'kycVerificationSubmit')->name('kyc.verification.submit');
            Route::post('kyc/sumsub/token/{id}', 'kycSumsubAccessToken')->name('kyc.sumsub.token');
            Route::get('verification/center', 'verificationCenter')->name('verification.center');
            Route::get('funds', 'fund')->name('fund.index');
            Route::get('transaction', 'transaction')->name('transaction.index');

        });

        //USER PROFILE UPDATE
        Route::controller(UserProfileController::class)->group(function () {
            Route::match(['get', 'post'], 'profile', 'index')->name('profile');
            Route::match(['get', 'post'], 'change-password', 'changePassword')->name('change.password');
            Route::match(['get', 'post'], 'notification', 'notification')->name('notification');
        });

        // TWO-FACTOR SECURITY
        Route::controller(FaSecurityController::class)->group(function () {
            Route::get('/twostep-security', 'twoStepSecurity')->name('twostep.security');
            Route::post('twoStep-enable', 'twoStepEnable')->name('twoStepEnable');
            Route::post('twoStep-disable', 'twoStepDisable')->name('twoStepDisable');
            Route::post('twoStep/re-generate', 'twoStepRegenerate')->name('twoStepRegenerate');
        });

        /* ===== In APP Notification ===== */
        Route::controller(InAppNotificationController::class)->group(function () {
            Route::get('push-notification-show', 'show')->name('push.notification.show');
            Route::get('push.notification.readAll', 'readAll')->name('push.notification.readAll');
            Route::get('push-notification-readAt/{id}', 'readAt')->name('push.notification.readAt');
        });

        /* USER SUPPORT TICKET */
        Route::controller(SupportController::class)->group(function () {
            Route::get('tickets', 'index')->name('ticket.list');
            Route::get('ticket-create', 'create')->name('ticket.create');
            Route::post('ticket-create', 'store')->name('ticket.store');
            Route::get('ticket-view/{ticket}', 'view')->name('ticket.view');
            Route::put('ticket-reply/{ticket}', 'reply')->name('ticket.reply');
            Route::get('ticket-download/{ticket}', 'download')->name('ticket.download');
        });
    });

    /* Manage User Deposit */
    Route::controller(DepositController::class)->group(function () {
        Route::get('supported-currency', 'supportedCurrency')->name('supported.currency');
        Route::post('payment-request', 'paymentRequest')->name('payment.request');
        Route::get('deposit-check-amount', 'checkAmount')->name('deposit.checkAmount');
    });


    /* Manage Payment */
    Route::controller(PaymentController::class)->group(function () {
        Route::get('payment-process/{trx_id}', 'depositConfirm')->name('payment.process');
        Route::post('addFundConfirm/{trx_id}', 'fromSubmit')->name('addFund.fromSubmit');
        Route::match(['get', 'post'], 'success', 'success')->name('success');
        Route::match(['get', 'post'], 'failed', 'failed')->name('failed');
        Route::match(['get', 'post'], 'payment/{code}/{trx?}/{type?}', 'gatewayIpn')->name('ipn');
    });

    Route::post('khalti/payment/verify/{trx}', [khaltiPaymentController::class, 'verifyPayment'])->name('khalti.verifyPayment');
    Route::post('khalti/payment/store', [khaltiPaymentController::class, 'storePayment'])->name('khalti.storePayment');

    Route::post('subscribe', [FrontendController::class, 'subscribe'])->name('subscribe');
    Route::post('/contact/send', [FrontendController::class, 'contactSend'])->name('contact.send');
    Route::get('blog-details', [FrontendController::class, 'blogDetails'])->name('blog.details');
    Route::get('tracking', [FrontendController::class, 'tracking'])->name('tracking');

    Route::get('auth/{socialite}', [SocialiteController::class, 'socialiteLogin'])->name('socialiteLogin');
    Route::get('auth/callback/{socialite}', [SocialiteController::class, 'socialiteCallback'])->name('socialiteCallback');

    /*= Frontend Manage Controller =*/
    Route::get('/captcha', [ManualRecaptchaController::class, 'reCaptCha'])->name('captcha');
    Auth::routes();

    Route::get('close/announcement', function () {
        session()->put('isCLoseAnnouncement', '1');
        return response()->json([
            'url' => url('/'),
        ]);
    })->name('closeAnnouncement');

    Route::get('language/{locale}', function ($locale, Request $request) {
        $language = Language::where('short_name', $locale)->where('status', 1)->first();

        if (!$language) {
            $language = Language::where('short_name', 'en')->first() ?: defaultLang();
        }

        if ($language) {
            session()->put('lang', $language->short_name);
            session()->put('rtl', $language->rtl);
        }

        $redirect = (string) $request->query('redirect', '');
        if ($redirect !== '') {
            $appUrl = rtrim(url('/'), '/');
            if (str_starts_with($redirect, $appUrl) || str_starts_with($redirect, '/')) {
                return redirect()->to($redirect);
            }
        }

        return redirect('/');
    })->name('language');

    Route::get("/{slug?}", [FrontendController::class, 'page'])->name('page');
});


