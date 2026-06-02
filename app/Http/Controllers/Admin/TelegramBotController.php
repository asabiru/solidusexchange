<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\TelegramBot;
use App\Services\Telegram\TelegramBotService;
use Illuminate\Http\Request;

class TelegramBotController extends Controller
{
    public function index()
    {
        $bots = TelegramBot::orderBy('id', 'desc')->get();
        return view('admin.telegram_bot.list', compact('bots'));
    }

    public function create()
    {
        return view('admin.telegram_bot.create');
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'bot_token' => 'required|string|max:255',
            'type' => 'required|in:general,support,mini_app',
        ]);

        $bot = TelegramBot::create([
            'name' => $request->name,
            'bot_token' => $request->bot_token,
            'webhook_url' => config('app.url') . '/telegram/webhook/' . $request->bot_token,
            'type' => $request->type,
            'is_active' => $request->is_active ?? true,
        ]);

        $service = new TelegramBotService($bot->bot_token);
        $service->setWebhook($bot->webhook_url);

        return redirect()->route('admin.telegram.bots')->with('success', 'Бот добавлен и webhook установлен.');
    }

    public function edit($id)
    {
        $bot = TelegramBot::findOrFail($id);
        return view('admin.telegram_bot.edit', compact('bot'));
    }

    public function update(Request $request, $id)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'type' => 'required|in:general,support,mini_app',
        ]);

        $bot = TelegramBot::findOrFail($id);
        $bot->update([
            'name' => $request->name,
            'type' => $request->type,
            'is_active' => $request->is_active ?? false,
        ]);

        return redirect()->route('admin.telegram.bots')->with('success', 'Бот обновлён.');
    }

    public function destroy($id)
    {
        $bot = TelegramBot::findOrFail($id);
        $service = new TelegramBotService($bot->bot_token);
        $service->deleteWebhook();
        $bot->delete();

        return back()->with('success', 'Бот удалён и webhook отключён.');
    }

    public function setWebhook($id)
    {
        $bot = TelegramBot::findOrFail($id);
        $service = new TelegramBotService($bot->bot_token);
        $service->setWebhook($bot->webhook_url);

        return back()->with('success', 'Webhook обновлён.');
    }

    public function getInfo($id)
    {
        $bot = TelegramBot::findOrFail($id);
        $service = new TelegramBotService($bot->bot_token);
        $info = $service->getMe();

        return back()->with('success', 'Инфо: ' . json_encode($info));
    }
}
