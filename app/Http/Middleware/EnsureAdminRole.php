<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminRole
{
    public function handle(Request $request, Closure $next, ...$roles): Response
    {
        $admin = Auth::guard('admin')->user();

        if (!$admin) {
            abort(403);
        }

        $currentRole = $admin->role ?? 'admin';
        $roles = $roles === [] ? ['admin'] : $roles;

        if (!in_array($currentRole, $roles, true)) {
            return $currentRole === 'trader'
                ? redirect()->route('admin.trader.dashboard')
                : redirect()->route('admin.dashboard');
        }

        return $next($request);
    }
}
