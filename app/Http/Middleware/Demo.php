<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class Demo
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $routeName = \Route::currentRouteName();
        $methods = ['POST','PUT','PATCH','DELETE'];
        if(config('demo.IS_DEMO') == true && in_array(request()->method(), $methods) && $routeName != 'admin.logout'){
            return back()->with('error', 'Это DEMO-версия. Вы можете изучить все функции, но't take any action.');
        }
        return $next($request);
    }
}
