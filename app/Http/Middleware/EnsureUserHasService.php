<?php

namespace App\Http\Middleware;

use Carbon\Carbon;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserHasService
{
    /**
     * Handle an incoming request.
     *
     * @param \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next, $service): Response
    {
        $user = auth()->user();
        if ($user->plan_id && ($user->use_contacts < $user->limit_contact) && ($user->use_emails < $user->limit_emails)) {
            $runningPlan = $user->plan;

            if ($runningPlan && $runningPlan->{$service} && $user->subs_expired_at > Carbon::now()) {
                return $next($request);
            }
        }
        if ($request->expectsJson()) {
            return response()->json(['status' => 'error', 'message' => 'To unlock access to this feature, kindly upgrade your current plan']);
        }
        return back()->with('warning', 'To unlock access to this feature, kindly upgrade your current plan.');
    }
}
