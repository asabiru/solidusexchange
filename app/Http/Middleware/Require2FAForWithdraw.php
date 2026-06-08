<?php

namespace App\Http\Middleware;

use App\Helpers\GoogleAuthenticator;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Require Google 2FA code for any manual withdrawal/transfer action.
 *
 * Applied to routes that move crypto manually:
 *   - InternalTransferController::store()
 *   - CustodialWithdrawalController::store() (admin manual withdraw)
 *
 * NOT applied to automatic payouts (exchange pipeline runs without user interaction).
 *
 * Usage in routes:
 *   Route::post(...)->middleware('require2fa.withdraw');
 */
class Require2FAForWithdraw
{
    public function handle(Request $request, Closure $next): Response
    {
        $admin = Auth::guard('admin')->user();

        if (!$admin) {
            return redirect()->route('admin.login');
        }

        // If 2FA is not enabled for this admin — skip check
        if (!(int)($admin->two_fa ?? 0) || empty($admin->two_fa_code)) {
            return $next($request);
        }

        $code = trim((string)$request->input('two_fa_code', ''));

        if (empty($code)) {
            return back()
                ->withInput($request->except('two_fa_code'))
                ->with('error', 'Google Authenticator code is required to execute this transfer.');
        }

        $ga      = new GoogleAuthenticator();
        $expected = $ga->getCode($admin->two_fa_code);

        if ($expected !== $code) {
            return back()
                ->withInput($request->except('two_fa_code'))
                ->with('error', 'Invalid Google Authenticator code. Please try again.');
        }

        return $next($request);
    }
}
