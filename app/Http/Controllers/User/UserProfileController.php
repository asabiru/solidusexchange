<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Models\Kyc;
use App\Models\Language;
use App\Models\NotificationTemplate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Stevebauman\Purify\Facades\Purify;
use Illuminate\Support\Facades\Validator;

class UserProfileController extends Controller
{
    public function __construct()
    {
        $this->middleware(['auth']);
        $this->middleware(function ($request, $next) {
            $this->user = auth()->user();
            return $next($request);
        });
        $this->theme = template();
    }

    public function changePassword(Request $request)
    {
        if ($request->isMethod('get')) {
            $data['kycs'] = Kyc::where('status', 1)->get();
            return view($this->theme . 'user.profile.change', $data);
        } elseif ($request->isMethod('post')) {
            $purifiedData = Purify::clean($request->all());
            $validator = Validator::make($purifiedData, [
                'currentPassword' => 'required|min:5',
                'password' => 'required|min:8|confirmed',
            ]);

            if ($validator->fails()) {
                return back()->withErrors($validator)->withInput();
            }
            try {
                $user = Auth::user();
                $purifiedData = (object)$purifiedData;

                if (!Hash::check($purifiedData->currentPassword, $user->password)) {
                    return back()->withInput()->withErrors(['currentPassword' => 'current password did not match']);
                }

                $user->password = bcrypt($purifiedData->password);
                $user->save();

                return back()->with('success', 'Password changed successfully');
            } catch (\Exception $e) {
                return back()->with('error', $e->getMessage());
            }
        }
    }

    public function index(Request $request)
    {
        $userProfile = $this->user;
        if ($request->isMethod('get')) {
            $data['kycs'] = Kyc::where('status', 1)->get();
            $data['languages'] = Language::where('status', 1)->get();
            $data['timeZones'] = timezone_identifiers_list();
            $kycProfileLocked = (int) $userProfile->identity_verify === 2;

            return view($this->theme . 'user.profile.show', $data, compact('userProfile', 'kycProfileLocked'));
        } elseif ($request->isMethod('post')) {
            $purifiedData = Purify::clean($request->all());

            $validator = Validator::make($purifiedData, [
                'username' => 'sometimes|required|min:5|max:50|unique:users,username,' . $userProfile->id,
                'email' => 'sometimes|required|min:5|max:50|unique:users,email,' . $userProfile->id,
            ]);

            if ($validator->fails()) {
                $validator->errors()->add('profile', '1');
                return back()->withErrors($validator)->withInput();
            }
            try {
                $purifiedData = (object)$purifiedData;
                if ($purifiedData->email != $userProfile->email) {
                    $userProfile->email_verification = 0;
                }

                $userProfile->username = $purifiedData->username;
                $userProfile->email = $purifiedData->email;

                $userProfile->save();
                return back()->with('success', 'Profile Update Successfully');

            } catch (\Exception $e) {
                return back()->with('error', $e->getMessage());
            }
        }
    }

    public function notification(Request $request)
    {
        if ($request->method() == 'GET') {
            $currentLanguage = Language::query()
                ->where('short_name', session('lang', app()->getLocale()))
                ->where('status', 1)
                ->first() ?: defaultLang();

            $data['kycs'] = Kyc::where('status', 1)->get();
            $data['templates'] = NotificationTemplate::query()
                ->select(['id', 'language_id', 'notify_for', 'template_key', 'name', 'status'])
                ->where('notify_for', 0)
                ->when($currentLanguage, function ($query) use ($currentLanguage) {
                    $query->where(function ($subQuery) use ($currentLanguage) {
                        $subQuery->where('language_id', $currentLanguage->id)
                            ->orWhereNull('language_id');
                    });
                })
                ->orderByRaw('CASE WHEN language_id = ? THEN 0 ELSE 1 END', [$currentLanguage?->id ?? 0])
                ->get()
                ->unique('template_key')
                ->values();

            return view($this->theme . 'user.notification.show', $data);
        } elseif ($request->method() == 'POST') {
            $user = $this->user;
            if ($request->has('email_key')) {
                $user->email_key = $request->email_key;
            }
            if ($request->has('sms_key')) {
                $user->sms_key = $request->sms_key;
            }
            if ($request->has('push_key')) {
                $user->push_key = $request->push_key;
            }
            if ($request->has('in_app_key')) {
                $user->in_app_key = $request->in_app_key;
            }
            $user->save();
            return back()->with('success', 'Notification settings updated successfully');
        }
    }
}
