<?php

namespace App\Http\Middleware;

use App\Models\Kyc;
use App\Models\UserKyc;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureKycVerified
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (!$user) {
            return redirect()->route('login');
        }

        // Fast path: user already marked as KYC-verified in the users table
        if ((int) $user->identity_verify === 2) {
            return $next($request);
        }

        // Cache active KYC types for 30 minutes (shared across all users)
        $activeKycs = \Illuminate\Support\Facades\Cache::remember(
            'active_kyc_types',
            now()->addMinutes(30),
            fn () => Kyc::query()->where('status', 1)->orderBy('id')->get()
        );

        if ($activeKycs->isEmpty()) {
            return $next($request);
        }

        // Cache per-user KYC approval for 10 minutes in session
        $sessionKey = 'kyc_ok_' . $user->id;
        if (session($sessionKey)) {
            return $next($request);
        }

        if (UserKyc::query()->where('user_id', $user->id)->where('status', 1)->exists()) {
            $user->forceFill(['identity_verify' => 2])->save();
            session([$sessionKey => true]);
            return $next($request);
        }

        $latestUserKyc = UserKyc::query()
            ->where('user_id', $user->id)
            ->latest()
            ->first();

        $message = 'Please complete KYC verification to continue.';
        $redirectUrl = route('user.verification.center');

        if ($latestUserKyc && (int) $latestUserKyc->status === 0) {
            $message = 'Your KYC verification is under review.';
            // Keep $redirectUrl = verification.center so user sees context
        } elseif ($latestUserKyc && (int) $latestUserKyc->status === 2) {
            $message = 'Your KYC verification was rejected. Please submit it again.';
            // For rejected, send directly to the form so they can resubmit
            $kyc = $activeKycs->firstWhere('id', $latestUserKyc->kyc_id) ?: $activeKycs->first();
            if ($kyc) {
                $redirectUrl = route('user.kyc', [$kyc->slug, $kyc->id]);
            }
        } else {
            // No KYC submitted yet — show verification center so user understands what to do
            $message = 'Please complete KYC verification to access your dashboard.';
            // $redirectUrl stays as verification.center (set above)
        }

        if ($request->expectsJson() || $request->ajax()) {
            return response()->json([
                'message' => $message,
                'redirect' => $redirectUrl,
            ], 403);
        }

        return redirect()->to($redirectUrl)->with('error', $message);
    }
}
