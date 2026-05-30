<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use PragmaRX\Google2FA\Google2FA;
use App\Traits\Notify;
use hisorange\BrowserDetect\Parser as Browser;
use Illuminate\Http\Request;

class FaSecurityController extends Controller
{
    use Notify;

    public function __construct()
    {
        $this->middleware(['auth']);
        $this->middleware(function ($request, $next) {
            $this->user = auth()->user();
            return $next($request);
        });
        $this->theme = template();
    }

    public function twoStepSecurity()
    {
        $basic = basicControl();
        $user = $this->user;

        $google2fa = new Google2FA();
        $secret = $user->two_fa_code ?? $this->generateSecretKeyForUser($user);
        $account = $user->username ?: $user->email;

        $qrCodeUrl = $google2fa->getQRCodeUrl(
            $basic->site_title,
            $account,
            $secret
        );
        $qrCodeImage = $this->makeQrCodeImage($qrCodeUrl);

        return view($this->theme . 'user.twoFA.index', compact('secret', 'qrCodeUrl', 'qrCodeImage'));
    }

    public function twoStepRegenerate()
    {
        $user = $this->user;
        $user->two_fa_code = null;
        $user->save();
        session()->flash('success','Re-generate Successfully');
        return redirect()->route('user.twostep.security');
    }

    private function generateSecretKeyForUser(User $user)
    {
        $google2fa = new Google2FA();
        $secret = $google2fa->generateSecretKey();
        $user->update(['two_fa_code' => $secret]);

        return $secret;
    }

    private function makeQrCodeImage(string $qrCodeUrl, int $size = 220): string
    {
        $query = http_build_query([
            'cht' => 'qr',
            'chs' => "{$size}x{$size}",
            'chld' => 'M|0',
            'chl' => $qrCodeUrl,
        ], '', '&', PHP_QUERY_RFC3986);

        return "https://quickchart.io/chart?{$query}";
    }

    public function twoStepEnable(Request $request)
    {
        $user = $this->user;
        $secret = auth()->user()->two_fa_code;
        $google2fa = new Google2FA();
        $valid = $google2fa->verifyKey($secret, $request->code);
        if ($valid) {
            $user['two_fa'] = 1;
            $user['two_fa_verify'] = 1;
            $user->save();

            $browser = new Browser();
            $this->mail($user, 'TWO_STEP_ENABLED', [
                'action' => 'Enabled',
                'code' => $user->two_fa_code,
                'ip' => request()->ip(),
                'browser' => $browser->browserName() . ', ' . $browser->platformName(),
                'time' => date('d M, Y h:i:s A'),
            ]);

            return back()->with('success', 'Google Authenticator включён.');
        } else {
            return back()->with('error', 'Неверный код подтверждения.');
        }
    }


    public function twoStepDisable(Request $request)
    {
        $this->validate($request, [
            'password' => 'required',
        ]);

        if (!Hash::check($request->password, auth()->user()->password)) {
            return back()->with('error', 'Неверный пароль. Пожалуйста, попробуйте снова.');
        }

        auth()->user()->update([
            'two_fa' => 0,
            'two_fa_verify' => 1,
        ]);
        return redirect()->route('user.dashboard')->with('success', 'Двухфакторная аутентификация успешно отключена.');
    }
}
