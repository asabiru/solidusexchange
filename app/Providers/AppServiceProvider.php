<?php

namespace App\Providers;

use App\Models\ContentDetails;
use App\Models\Language;
use App\Models\ManageMenu;
use App\Models\Page;
use App\Models\PageDetail;
use App\Models\UserKyc;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\View;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\Bridge\Mailchimp\Transport\MandrillTransportFactory;
use Symfony\Component\Mailer\Bridge\Sendgrid\Transport\SendgridTransportFactory;
use Symfony\Component\Mailer\Bridge\Sendinblue\Transport\SendinblueTransportFactory;
use Symfony\Component\Mailer\Transport\Dsn;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        try {
            DB::connection()->getPdo();
            $data['basicControl'] = basicControl();
            $data['theme'] = template();
            $data['themeTrue'] = template(true);
            View::share($data);

            view()->composer([
                $data['theme'] . 'partials.header',
                $data['theme'] . 'partials.footer',
                $data['theme'] . 'page',
            ], function ($view) {
                $menus = ManageMenu::whereIn('menu_section', ['header', 'footer'])->get()->keyBy('menu_section');
                $view->with([
                    'headerMenu' => $menus->get('header'),
                    'footerMenu' => $menus->get('footer'),
                ]);

                $extraInfo = ContentDetails::with(['content'])->whereHas('content', function ($query) {
                    return $query->whereIn('name', ['contact', 'social']);
                })->get()->groupBy('content.name');
                $view->with('extraInfo', $extraInfo);

                $languages = Language::orderBy('name')->where('status', 1)->get();
                $view->with('languages', $languages);
            });


            if (basicControl()->force_ssl == 1) {
                if ($this->app->environment('production') || $this->app->environment('local')) {
                    \URL::forceScheme('https');
                }
            }

            Mail::extend('sendinblue', function () {
                return (new SendinblueTransportFactory)->create(
                    new Dsn(
                        'sendinblue+api',
                        'default',
                        config('services.sendinblue.key')
                    )
                );
            });

            Mail::extend('sendgrid', function () {
                return (new SendgridTransportFactory)->create(
                    new Dsn(
                        'sendgrid+api',
                        'default',
                        config('services.sendgrid.key')
                    )
                );
            });

            Mail::extend('mandrill', function () {
                return (new MandrillTransportFactory)->create(
                    new Dsn(
                        'mandrill+api',
                        'default',
                        config('services.mandrill.key')
                    )
                );
            });
        } catch (\Exception $e) {
        }
    }
}
