<?php

namespace App\Http\Controllers;

use App\Mail\SendMail;
use App\Models\BuyRequest;
use App\Models\ContentDetails;
use App\Models\ExchangeRequest;
use App\Models\Language;
use App\Models\PageDetail;
use App\Models\SellRequest;
use App\Models\Subscribe;
use App\Traits\Frontend;
use App\Traits\Notify;
use App\Traits\SendNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Stevebauman\Purify\Facades\Purify;
use Facades\App\Services\BasicService;

class FrontendController extends Controller
{
    use Notify, Frontend, SendNotification;

    public function __construct()
    {
        $this->theme = template();
    }

    public function page($slug = '/')
    {
        try {
            $slug = $slug ?: '/';
            $selectedTheme = basicControl()->theme ?? 'light';
            [$preferredLanguageId, $fallbackLanguageId] = $this->languagePriorityIds();
            $existingSlugs = collect([]);
            DB::table('pages')->select('slug')->get()->map(function ($item) use ($existingSlugs) {
                $existingSlugs->push($item->slug);
            });
            if (!in_array($slug, $existingSlugs->toArray())) {
                abort(404);
            }

            $pageDetails = $this->resolvePageDetail($slug, $selectedTheme, $preferredLanguageId, $fallbackLanguageId);
            if (!$pageDetails) {
                return redirect()->route('instructionPage');
            }

            $pageSeo = [
                'page_title' => optional($pageDetails->page)->page_title,
                'meta_title' => optional($pageDetails->page)->meta_title,
                'meta_keywords' => implode(',', optional($pageDetails->page)->meta_keywords ?? []),
                'meta_description' => optional($pageDetails->page)->meta_description,
                'og_description' => optional($pageDetails->page)->og_description,
                'meta_robots' => optional($pageDetails->page)->meta_robots,
                'meta_image' => getFile(optional($pageDetails->page)->meta_image_driver, optional($pageDetails->page)->meta_image),
                'breadcrumb_image' => optional($pageDetails->page)->breadcrumb_status ?
                    getFile(optional($pageDetails->page)->breadcrumb_image_driver, optional($pageDetails->page)->breadcrumb_image) : null,
            ];

            $sectionsData = $this->getSectionsData(
                $pageDetails->sections,
                $pageDetails->content,
                $selectedTheme,
                $preferredLanguageId,
                $fallbackLanguageId
            );

            $renderedPage = view("themes.{$selectedTheme}.page", compact('sectionsData', 'pageSeo'))->render();

            return response($renderedPage);

        } catch (\Exception $exception) {
            report($exception);

            \Cache::forget('ConfigureSetting');
            if ($exception->getCode() == 404) {
                abort(404);
            }
            if ($exception->getCode() == 403) {
                abort(403);
            }
            if ($exception->getCode() == 401) {
                abort(401);
            }

            if ($exception->getCode() == 503) {
                return redirect()->route('maintenance');
            }
            if ($exception->getCode() == 1049) {
                die('Unable to establish a connection to the database. Please check your connection settings and try again later');
            }

            if (config('app.debug')) {
                throw $exception;
            }

            return redirect()->route('instructionPage');
        }
    }

    public function blogDetails(Request $request)
    {
        $search = $request->all();
        [$preferredLanguageId, $fallbackLanguageId] = $this->languagePriorityIds();

        $data['blogDetails'] = ContentDetails::withoutGlobalScope('language')
            ->select(['id', 'description', 'content_id', 'created_at', 'language_id'])
            ->with('content')
            ->where('id', $request->id)
            ->firstOrFail();

        $data['popularContentDetails'] = ContentDetails::withoutGlobalScope('language')
            ->select('id', 'content_id', 'description', 'created_at', 'language_id')
            ->where('id', '!=', $request->id)
            ->whereHas('content', function ($query) {
                return $query->where('type', 'multiple')->whereIn('name', ['blog']);
            })
            ->when(isset($search['title']), function ($query) use ($search) {
                $query->where('description', 'LIKE', '%' . $search['title'] . '%');
            })
            ->get()
            ->groupBy('content_id')
            ->map(function ($items) use ($preferredLanguageId, $fallbackLanguageId) {
                return $items->sortBy(function ($item) use ($preferredLanguageId, $fallbackLanguageId) {
                    return $this->languagePriorityScore((int) $item->language_id, $preferredLanguageId, $fallbackLanguageId);
                })->first();
            })
            ->filter()
            ->groupBy('content.name');

        $selectedTheme = basicControl()->theme;
        $pageDetails = $this->resolvePageDetail('blog', $selectedTheme, $preferredLanguageId, $fallbackLanguageId);

        $pageSeo = [
            'page_title' => 'Blog Details',
            'breadcrumb_image' => optional($pageDetails->page)->breadcrumb_status ? getFile(optional($pageDetails->page)->breadcrumb_image_driver, optional($pageDetails->page)->breadcrumb_image) : null,
        ];

        return view($this->theme . 'blog_details', $data, compact('pageSeo'));
    }

    private function languagePriorityIds(): array
    {
        $preferredLanguage = Language::query()
            ->where('short_name', app()->getLocale())
            ->first();

        $fallbackLanguage = defaultLang() ?: Language::query()
            ->where('status', 1)
            ->first();

        $englishLanguage = Language::query()
            ->where('short_name', 'en')
            ->first();

        if ($fallbackLanguage && $preferredLanguage && $fallbackLanguage->id === $preferredLanguage->id) {
            $fallbackLanguage = $englishLanguage ?: $fallbackLanguage;
        }

        return [
            $preferredLanguage?->id,
            $fallbackLanguage?->id,
        ];
    }

    private function resolvePageDetail(string $slug, string $selectedTheme, ?int $preferredLanguageId, ?int $fallbackLanguageId): ?PageDetail
    {
        $languageIds = collect([$preferredLanguageId, $fallbackLanguageId])
            ->filter()
            ->unique()
            ->values()
            ->all();

        $query = PageDetail::withoutGlobalScope('language')
            ->with('page')
            ->whereHas('page', function ($query) use ($slug, $selectedTheme) {
                $query->where(['slug' => $slug, 'template_name' => $selectedTheme]);
            });

        if (!empty($languageIds)) {
            $query->whereIn('language_id', $languageIds);
        }

        return $query->get()
            ->sortBy(function (PageDetail $detail) use ($preferredLanguageId, $fallbackLanguageId) {
                return $this->languagePriorityScore((int) $detail->language_id, $preferredLanguageId, $fallbackLanguageId);
            })
            ->first();
    }

    private function languagePriorityScore(?int $languageId, ?int $preferredLanguageId, ?int $fallbackLanguageId): int
    {
        if ($preferredLanguageId && $languageId === $preferredLanguageId) {
            return 0;
        }

        if ($fallbackLanguageId && $languageId === $fallbackLanguageId) {
            return 1;
        }

        return 2;
    }


    public function subscribe(Request $request)
    {
        $purifiedData = $request->all();
        $validationRules = [
            'email' => 'required|email|min:8|max:100|unique:subscribes',
        ];
        $validate = Validator::make($purifiedData, $validationRules);
        if ($validate->fails()) {
            session()->flash('error', 'Email Field is required');
            return back()->withErrors($validate)->withInput();
        }
        $purifiedData = (object)$purifiedData;

        $subscribe = new Subscribe();
        $subscribe->email = $purifiedData->email;
        $subscribe->save();

        return back()->with('success', 'Subscribed successfully');
    }

    public function contactSend(Request $request)
    {
        $this->validate($request, [
            'name' => 'required|max:50',
            'email' => 'required|email|max:91',
            'subject' => 'required|max:100',
            'message' => 'required|max:1000',
        ]);
        $requestData = $request->except('_token', '_method');

        $name = $requestData['name'];
        $email_from = $requestData['email'];
        $subject = $requestData['subject'];
        $message = $requestData['message'] . "<br>Regards<br>" . $name;
        $from = $email_from;

        Mail::to(basicControl()->sender_email)->send(new SendMail($from, $subject, $message));
        return back()->with('success', 'Mail has been sent');
    }

    public function tracking(Request $request)
    {
        $data = array();
        if ($request->trx_id) {
            $firstCharacter = substr($request->trx_id, 0, 1);
            if ($firstCharacter == 'E') {
                $exchange = ExchangeRequest::whereIn('status', [2, 3, 5])->where('utr', $request->trx_id)->latest()->first();
                if ($exchange) {
                    $data['type'] = 'exchange';
                    $data['object'] = $exchange;
                }
            } elseif ($firstCharacter == 'B') {
                $buy = BuyRequest::whereIn('status', [2, 3, 5])->where('utr', $request->trx_id)->latest()->first();
                if ($buy) {
                    $data['type'] = 'buy';
                    $data['object'] = $buy;
                }
            } elseif ($firstCharacter == 'S') {
                $sell = SellRequest::whereIn('status', [2, 3, 5])->where('utr', $request->trx_id)->latest()->first();
                if ($sell) {
                    $data['type'] = 'sell';
                    $data['object'] = $sell;
                }
            }
        }
        return view($this->theme . 'tracking', $data);
    }
}
