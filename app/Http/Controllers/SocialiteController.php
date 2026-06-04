<?php

namespace App\Http\Controllers;

use App\Helpers\UserSystemInfo;
use App\Models\Language;
use App\Models\User;
use App\Models\UserLogin;
use App\Services\Telegram\TelegramMiniAppAuthService;
use App\Traits\Upload;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;


class SocialiteController extends Controller
{
    use Upload;

    public function socialiteLogin($socialite)
    {
        if ($socialite === 'telegram') {
            return redirect()->route('login');
        }

        if (config('socialite.' . $socialite . '_status')) {
            return Socialite::driver($socialite)->redirect();
        }
        return redirect()->route('login');
    }

    public function socialiteCallback(Request $request, $socialite)
    {
        if ($socialite === 'telegram') {
            return $this->telegramCallback($request);
        }

        try {
            $user = Socialite::driver($socialite)->user();
            $columName = $socialite . '_id';
            $searchUser = User::where($columName, $user->id)->first();

            if ($searchUser) {
                Auth::login($searchUser);
                return redirect()->to(url('/'));

            } else {
                $languageId = Language::select('id')->where('default_status', 1)->first()->id ?? null;

                $newUser = User::create([
                    'first_name' => $user->name,
                    'email' => $user->email,
                    'username' => $user->email,
                    'password' => Hash::make($user->name),
                    $columName => $user->id,
                    'language_id' => $languageId,
                    'email_verification' => (basicControl()->email_verification) ? 0 : 1,
                    'sms_verification' => (basicControl()->sms_verification) ? 0 : 1,
                ]);

                $this->extraWorkWithRegister($newUser);
                Auth::login($newUser);
                return redirect()->to(url('/'));
            }

        } catch (\Exception $e) {
            return redirect()->route('login');
        }
    }

    private function telegramCallback(Request $request)
    {
        if (!config('socialite.telegram_status')) {
            return redirect()->route('login');
        }

        $telegramAuth = $request->only([
            'id',
            'first_name',
            'last_name',
            'username',
            'photo_url',
            'auth_date',
            'hash',
        ]);

        if (!$this->validateTelegramAuthData($telegramAuth)) {
            return redirect()->route('login')->with('error', 'Telegram authorization failed.');
        }

        $telegramId = (string)$telegramAuth['id'];
        $searchUser = User::where('provider', 'telegram')
            ->where('provider_id', $telegramId)
            ->first();

        if ($searchUser) {
            Auth::login($searchUser);
            return redirect()->to(url('/'));
        }

        $languageId = Language::select('id')->where('default_status', 1)->first()->id ?? null;
        $newUser = User::create([
            'firstname' => $telegramAuth['first_name'] ?? ($telegramAuth['username'] ?? 'Telegram'),
            'lastname' => $telegramAuth['last_name'] ?? null,
            'username' => $this->generateTelegramUsername($telegramAuth),
            'password' => Hash::make(Str::random(32)),
            'provider' => 'telegram',
            'provider_id' => $telegramId,
            'language_id' => $languageId,
            'email_verification' => 1,
            'sms_verification' => 1,
        ]);

        $this->extraWorkWithRegister($newUser);
        Auth::login($newUser);

        return redirect()->to(url('/'));
    }


    public function telegramMiniAppLogin(Request $request, TelegramMiniAppAuthService $authService)
    {
        if (!config('socialite.telegram_status')) {
            return response()->json(['message' => __('Telegram authorization is disabled.')], 403);
        }

        $initData = (string) ($request->input('initData') ?: $request->header('X-Telegram-Init-Data'));

        try {
            $telegramAuth = $authService->validateInitData($initData);
            $user = $authService->syncUser($telegramAuth, Auth::user());
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => __('Telegram Mini App authorization failed.')], 422);
        }

        Auth::login($user);

        return response()->json([
            'authenticated' => true,
            'redirect' => route('telegram.mini-app'),
        ]);
    }

    private function validateTelegramAuthData(array $telegramAuth): bool
    {
        if (empty(config('services.telegram.bot_token'))) {
            return false;
        }

        if (empty($telegramAuth['hash']) || empty($telegramAuth['id']) || empty($telegramAuth['auth_date'])) {
            return false;
        }

        $authDate = (int)$telegramAuth['auth_date'];
        if ($authDate < (time() - 86400)) {
            return false;
        }

        $checkHash = (string)$telegramAuth['hash'];
        unset($telegramAuth['hash']);

        ksort($telegramAuth);
        $dataCheckArray = [];
        foreach ($telegramAuth as $key => $value) {
            if ($value !== null && $value !== '') {
                $dataCheckArray[] = $key . '=' . $value;
            }
        }

        $dataCheckString = implode("\n", $dataCheckArray);
        $secretKey = hash('sha256', config('services.telegram.bot_token'), true);
        $calculatedHash = hash_hmac('sha256', $dataCheckString, $secretKey);

        return hash_equals($calculatedHash, $checkHash);
    }

    private function generateTelegramUsername(array $telegramAuth): string
    {
        $baseUsername = (string)($telegramAuth['username'] ?? ('tg_' . $telegramAuth['id']));
        $baseUsername = Str::lower((string)preg_replace('/[^A-Za-z0-9_]/', '', $baseUsername));
        $baseUsername = $baseUsername !== '' ? Str::limit($baseUsername, 90, '') : ('tg_' . $telegramAuth['id']);

        $username = $baseUsername;
        $counter = 1;

        while (User::where('username', $username)->exists()) {
            $suffix = (string)$counter;
            $trimmedBase = Str::limit($baseUsername, 90 - strlen($suffix), '');
            $username = $trimmedBase . $suffix;
            $counter++;
        }

        return $username;
    }

    public function extraWorkWithRegister($newUser): void
    {
        $newUser->last_login = Carbon::now();
        $newUser->last_seen = Carbon::now();
        $newUser->two_fa_verify = ($newUser->two_fa == 1) ? 0 : 1;
        $newUser->save();

        $info = @json_decode(json_encode(getIpInfo()), true);
        $ul['user_id'] = $newUser->id;

        $ul['longitude'] = (!empty(@$info['long'])) ? implode(',', $info['long']) : null;
        $ul['latitude'] = (!empty(@$info['lat'])) ? implode(',', $info['lat']) : null;
        $ul['country_code'] = (!empty(@$info['code'])) ? implode(',', $info['code']) : null;
        $ul['location'] = (!empty(@$info['city'])) ? implode(',', $info['city']) . (" - " . @implode(',', @$info['area']) . "- ") . @implode(',', $info['country']) . (" - " . @implode(',', $info['code']) . " ") : null;
        $ul['country'] = (!empty(@$info['country'])) ? @implode(',', @$info['country']) : null;

        $ul['ip_address'] = UserSystemInfo::get_ip();
        $ul['browser'] = UserSystemInfo::get_browsers();
        $ul['os'] = UserSystemInfo::get_os();
        $ul['get_device'] = UserSystemInfo::get_device();

        UserLogin::create($ul);
    }
}
