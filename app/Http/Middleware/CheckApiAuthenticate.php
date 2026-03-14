<?php

namespace App\Http\Middleware;

use App\Traits\ApiValidation;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class CheckApiAuthenticate
{
    use ApiValidation;

    /**
     * Handle an incoming request.
     *
     * @param \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $publicKey = $request->header('PublicKey');
        $secretKey = $request->header('SecretKey');

        $validator = Validator::make([
            'PublicKey' => $publicKey,
            'SecretKey' => $secretKey,
        ], [
            'PublicKey' => [
                'required',
                Rule::exists('users', 'public_key')->where(function ($query) {
                    return $query->where('status', 1);
                }),
            ],
            'SecretKey' => [
                'required',
                Rule::exists('users', 'secret_key')->where(function ($query) use ($publicKey) {
                    return $query->where('public_key', $publicKey);
                }),
            ],
        ]);

        if ($validator->fails()) {
            return response()->json($this->withErrors($validator->errors()));
        }

        return $next($request);
    }
}
