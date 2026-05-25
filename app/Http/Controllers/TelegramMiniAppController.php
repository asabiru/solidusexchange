<?php

namespace App\Http\Controllers;

use App\Services\Telegram\TelegramMiniAppAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class TelegramMiniAppController extends Controller
{
    public function launch(Request $request, TelegramMiniAppAuthService $authService)
    {
        $initData = (string) ($request->input('tgWebAppData') ?: $request->input('initData') ?: $request->header('X-Telegram-Init-Data'));

        if ($initData !== '') {
            $payload = $authService->validateInitData($initData);
            $user = $authService->syncUser($payload);
            Auth::login($user);
        }

        return redirect()->route('page');
    }
}
