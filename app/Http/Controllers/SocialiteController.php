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
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;


class SocialiteController extends Controller
{
    use Upload;

    public function socialiteLogin($socialite)
    {
        if ($socialite === 'telegram') {
            $botId = explode(':', (string) config('services.telegram.bot_token'))[0] ?? '';
            if ($botId !== '') {
                $callbackUrl = route('socialiteCallback', ['socialite' => 'telegram']);
                $oauthUrl = 'https://oauth.telegram.org/auth?bot_id=' . $botId
                    . '&origin=' . urlencode(config('app.url'))
                    . '&embed=0&return_to=' . urlencode($callbackUrl);
                return redirect()->away($oauthUrl);
            }
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

        $telegramAuth = $this->telegramAuthPayload($request);
        if ($telegramAuth === []) {
            return $this->telegramOAuthBridge($request);
        }

        if (!$this->validateTelegramAuthData($telegramAuth)) {
            return redirect()->route('login')->with('error', 'Telegram authorization failed.');
        }

        $telegramId = (string)$telegramAuth['id'];
        $searchUser = User::where('telegram_id', $telegramId)
            ->orWhere(function($q) use ($telegramId) {
                $q->where('provider', 'telegram')->where('provider_id', $telegramId);
            })
            ->first();

        if ($searchUser) {
            if (!$searchUser->telegram_id) {
                $searchUser->update([
                    'telegram_id' => $telegramId,
                    'telegram_username' => $telegramAuth['username'] ?? $searchUser->telegram_username,
                ]);
            }
        }

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
            'telegram_id' => $telegramId,
            'telegram_username' => $telegramAuth['username'] ?? null,
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

        $initData = (string) ($request->header('X-Telegram-Init-Data') ?: $request->input('initData'));

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
        $botToken = trim((string) config('services.telegram.bot_token'));
        if ($botToken === '') {
            $this->logTelegramAuthFailure('missing_bot_token', $telegramAuth);
            return false;
        }

        if (empty($telegramAuth['hash']) || empty($telegramAuth['id']) || empty($telegramAuth['auth_date'])) {
            $this->logTelegramAuthFailure('missing_required_fields', $telegramAuth);
            return false;
        }

        $authDate = (int)$telegramAuth['auth_date'];
        if ($authDate < (time() - 86400)) {
            $this->logTelegramAuthFailure('expired_auth_date', $telegramAuth, [
                'age_seconds' => time() - $authDate,
            ]);
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
        $secretKey = hash('sha256', $botToken, true);
        $calculatedHash = hash_hmac('sha256', $dataCheckString, $secretKey);

        $isValid = hash_equals($calculatedHash, $checkHash);
        if (!$isValid) {
            $this->logTelegramAuthFailure('hash_mismatch', $telegramAuth, [
                'data_keys' => array_keys($telegramAuth),
                'received_hash_length' => strlen($checkHash),
                'calculated_hash_length' => strlen($calculatedHash),
            ]);
        }

        return $isValid;
    }

    private function telegramAuthPayload(Request $request): array
    {
        parse_str((string) $request->server('QUERY_STRING'), $query);

        if (isset($query['tgAuthResult'])) {
            $encoded = strtr((string) $query['tgAuthResult'], '-_', '+/');
            $encoded .= str_repeat('=', (4 - strlen($encoded) % 4) % 4);
            $decoded = base64_decode($encoded, true);
            if ($decoded !== false) {
                $payload = json_decode($decoded, true);
                if (is_array($payload)) {
                    return $payload;
                }
            }
        }

        return $query ?: $request->query();
    }

    private function telegramOAuthBridge(Request $request)
    {
        $callbackUrl = route('socialiteCallback', ['socialite' => 'telegram']);

        return response(<<<HTML
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Telegram authorization</title>
</head>
<body style="margin:0;background:#0b0608;color:#e8c9a0;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center;">
    <div>Завершаем вход через Telegram...</div>
    <script>
        (function () {
            var hash = window.location.hash ? window.location.hash.substring(1) : '';
            if (hash) {
                window.location.replace('{$callbackUrl}?' + hash);
                return;
            }
            window.location.replace('/login?telegram_auth=empty');
        })();
    </script>
</body>
</html>
HTML);
    }

    private function logTelegramAuthFailure(string $reason, array $payload, array $extra = []): void
    {
        Log::warning('Telegram OAuth validation failed', array_merge([
            'reason' => $reason,
            'keys' => array_keys($payload),
            'has_hash' => !empty($payload['hash']),
            'has_id' => !empty($payload['id']),
            'has_auth_date' => !empty($payload['auth_date']),
        ], $extra));
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
