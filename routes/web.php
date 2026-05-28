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
use App\Http\Controllers\SchedulerController;

$basicControl = basicControl();


Route::get('maintenance-mode', function () {
    if (!basicControl()->is_maintenance_mode) {
        return redirect(route('home'));
    }
    $data['maintenanceMode'] = \App\Models\MaintenanceMode::first();
    return view(template() . 'maintenance', $data);
})->name('maintenance');

Route::get('password/reset', [ForgotPasswordController::class, 'showLinkRequestForm'])->name('password.request');
Route::post('password/email', [ForgotPasswordController::class, 'sendResetLinkEmail'])->middleware('throttle:password-reset')->name('password.email');
Route::get('password/reset/{token}', [ResetPasswordController::class, 'showResetForm'])->name('password.reset')->middleware('guest');
Route::post('password/reset', [ResetPasswordController::class, 'reset'])->middleware('throttle:password-reset')->name('password.reset.update');
    Route::get('instruction/page', function () {
        return view('instruction-page');
    })->name('instructionPage');

    // HTTP-triggered scheduler endpoints (for shared hosting without crontab)
    // Protected by scheduler_secret + rate-limited to prevent brute-force
    Route::get('__scheduler/run', [SchedulerController::class, 'run'])->middleware('throttle:6,1');
    Route::get('__scheduler/sync-crypto', [SchedulerController::class, 'syncCryptoRates'])->middleware('throttle:6,1');
    Route::get('__scheduler/sync-fiat', [SchedulerController::class, 'syncFiatRates'])->middleware('throttle:6,1');

    Route::get('license', function () {
        return redirect()->route('page');
    })->name('license.redirect');

    Route::get('__routecheck', function () {
        abort_unless(config('app.debug'), 404);

        $names = ['doc', 'docs', 'documentation', 'price', 'pricing', 'tracking'];
        $data = [];

        foreach ($names as $name) {
            $data[$name] = [
                'has' => \Illuminate\Support\Facades\Route::has($name),
                'url' => \Illuminate\Support\Facades\Route::has($name) ? route($name) : null,
            ];
        }

        return response()->json([
            'app_url' => config('app.url'),
            'current_url' => url()->current(),
            'routes' => $data,
        ]);
    })->name('debug.routecheck');


Route::group(['middleware' => ['maintenanceMode']], function () use ($basicControl) {
    Route::group(['middleware' => ['guest']], function () {
        Route::get('/login', [UserLoginController::class, 'showLoginForm'])->name('login');
        Route::post('/login', [UserLoginController::class, 'login'])->middleware('throttle:login')->name('login.submit');
        Route::post('/auth/telegram-miniapp', [SocialiteController::class, 'telegramMiniAppLogin'])->middleware('throttle:login')->name('telegram.miniapp.login');
    });

    $resolveLegacyPage = function (string $slug, array $fallbackSlugs = ['/']) {
        $candidateSlugs = collect(array_merge([$slug], $fallbackSlugs))
            ->filter()
            ->unique()
            ->values();

        $existingSlugs = DB::table('pages')
            ->whereIn('slug', $candidateSlugs->all())
            ->pluck('slug')
            ->all();

        $targetSlug = $candidateSlugs->first(function ($candidate) use ($existingSlugs) {
            return in_array($candidate, $existingSlugs, true);
        }) ?: '/';

        return app(FrontendController::class)->page($targetSlug);
    };

    Route::get('check', [VerificationController::class, 'check'])->name('check');
    Route::get('resend_code', [VerificationController::class, 'resendCode'])->name('user.resendCode');
    Route::get('verification/resend', [VerificationController::class, 'resendCode'])->name('verification.resend');
    Route::post('mail-verify', [VerificationController::class, 'mailVerify'])->middleware('throttle:two-fa')->name('user.mailVerify');
    Route::post('sms-verify', [VerificationController::class, 'smsVerify'])->middleware('throttle:two-fa')->name('user.smsVerify');
    Route::post('twoFA-Verify', [VerificationController::class, 'twoFAverify'])->middleware('throttle:two-fa')->name('user.twoFA-Verify');

    $legacyPageRoutes = [
        // 'home' removed — conflicts with Route::get("/", ...)->name('home') defined below
        'about' => ['about'],
        'feature' => ['feature'],
        'features' => ['feature', '/'],
        'faq' => ['faq'],
        'faqs' => ['faq', '/'],
        'contact' => ['contact'],
        'contacts' => ['contact', '/'],
        'contact-us' => ['contact', '/'],
        'pricing' => ['pricing', 'price', 'feature', '/'],
        'price' => ['price', 'pricing', 'feature', '/'],
        'prices' => ['price', 'pricing', 'feature', '/'],
        'terms' => ['terms-and-conditions', '/'],
        'term' => ['terms-and-conditions', '/'],
        'terms-and-conditions' => ['terms-and-conditions'],
        'privacy' => ['privacy-policy', '/'],
        'policy' => ['privacy-policy', '/'],
        'privacy-policy' => ['privacy-policy'],
        'blog' => ['blog', '/'],
        'documentation' => ['documentation', 'doc', 'docs', '/'],
        'docs' => ['docs', 'documentation', 'doc', '/'],
        'doc' => ['doc', 'documentation', 'docs', '/'],
    ];

    foreach ($legacyPageRoutes as $routeName => $candidateSlugs) {
        Route::get($routeName, fn() => $resolveLegacyPage($candidateSlugs[0], array_slice($candidateSlugs, 1)))
            ->name($routeName);
    }

    Route::group(['middleware' => ['auth', 'verifyUser'], 'prefix' => 'user', 'as' => 'user.'], function () {

        Route::controller(HomeController::class)->group(function () {
            Route::post('save-token', 'saveToken')->name('save.token');

            Route::get('kyc/{slug}/{id}', 'kycShow')->name('kyc');
            Route::post('kyc/submit/{id}', 'kycVerificationSubmit')->name('kyc.verification.submit');
            Route::post('kyc/amlbot/session/{id}', 'kycAmlBotSession')->name('kyc.amlbot.session');
            Route::get('verification/center', 'verificationCenter')->name('verification.center');
        });

        Route::group(['middleware' => ['verifiedKyc']], function () {
            Route::controller(HomeController::class)->group(function () {
                Route::get('dashboard', 'index')->name('dashboard');
                Route::get('funds', 'fund')->name('fund.index');
                Route::get('transaction', 'transaction')->name('transaction.index');
            });
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
    Route::group(['middleware' => ['auth', 'verifyUser', 'verifiedKyc']], function () {
        Route::controller(DepositController::class)->group(function () {
            Route::get('supported-currency', 'supportedCurrency')->name('supported.currency');
            Route::post('payment-request', 'paymentRequest')->name('payment.request');
            Route::get('deposit-check-amount', 'checkAmount')->name('deposit.checkAmount');
        });
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

    /* SBP QR Webhooks & Status Check */
    Route::post('sbp/webhook/tinkoff', [\App\Http\Controllers\SbpWebhookController::class, 'tinkoffNotify'])->name('sbp.webhook.tinkoff');
    Route::get('sbp/status/{orderId}', [\App\Http\Controllers\SbpWebhookController::class, 'checkStatus'])->name('sbp.status');

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
            if (str_starts_with($redirect, '/')) {
                return redirect()->to($redirect);
            }

            $appHost = parse_url((string) config('app.url'), PHP_URL_HOST) ?: $request->getHost();
            $redirectHost = parse_url($redirect, PHP_URL_HOST);

            if (is_string($redirectHost) && is_string($appHost) && strcasecmp($redirectHost, $appHost) === 0) {
                $redirectPath = parse_url($redirect, PHP_URL_PATH) ?: '/';
                $redirectQuery = parse_url($redirect, PHP_URL_QUERY);
                $redirectFragment = parse_url($redirect, PHP_URL_FRAGMENT);

                $normalizedRedirect = $redirectPath;
                if ($redirectQuery) {
                    $normalizedRedirect .= '?' . $redirectQuery;
                }
                if ($redirectFragment) {
                    $normalizedRedirect .= '#' . $redirectFragment;
                }

                return redirect()->to($normalizedRedirect);
            }
        }

        return redirect('/');
    })->name('language');

    Route::get("/", [FrontendController::class, 'home'])->name('home');

    // Public buy/sell routes (create request without auth)
    Route::post('/buy/request/public', [App\Http\Controllers\User\BuyController::class, 'publicBuyRequest'])->name('publicBuyRequest');
    Route::post('/sell/request/public', [App\Http\Controllers\User\SellController::class, 'publicSellRequest'])->name('publicSellRequest');

    Route::get("/{slug?}", [FrontendController::class, 'page'])->name('page');
});

