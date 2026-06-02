<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class TelegramMiniAppController extends Controller
{
    public function index(Request $request)
    {
        return view('telegram.mini-app');
    }
}
