<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class Demo
{
    public function handle(Request $request, Closure $next): Response
    {
        $routeName = \Route::currentRouteName();
        $methods = ['POST','PUT','PATCH','DELETE'];
        if(config('demo.IS_DEMO') == true && in_array(request()->method(), $methods) && $routeName != 'admin.logout'){
            return back()->with('error', 'Это DEMO-версия. Вы можете изучить все функции, но не можете выполнять действия.');
        }
        return $next($request);
    }
}
