<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use App\Models\SupportTicket;
use App\Models\SupportTicketMessage;
use App\Models\TelegramBot;
use App\Models\TelegramBotChat;
use App\Models\User;
use App\Services\Telegram\TelegramBotService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TelegramWebhookController extends Controller
{
    protected TelegramBotService $botService;

    public function __construct(TelegramBotService $botService)
    {
        $this->botService = $botService;
    }

    public function handle(Request $request, string $token)
    {
        $bot = TelegramBot::where('bot_token', $token)->where('is_active', true)->first();

        if (!$bot) {
            return response()->json(['ok' => false], 403);
        }

        $this->botService->setBot($bot);
        $update = $request->all();

        if (isset($update['message'])) {
            $this->handleMessage($update['message'], $bot);
        } elseif (isset($update['callback_query'])) {
            $this->handleCallbackQuery($update['callback_query'], $bot);
        }

        return response()->json(['ok' => true]);
    }

    protected function handleMessage(array $message, TelegramBot $bot)
    {
        $chatId = $message['chat']['id'];
        $text = $message['text'] ?? '';
        $username = $message['chat']['username'] ?? null;
        $firstName = $message['chat']['first_name'] ?? null;
        $lastName = $message['chat']['last_name'] ?? null;

        $chat = TelegramBotChat::firstOrCreate(
            ['telegram_bot_id' => $bot->id, 'chat_id' => $chatId],
            [
                'username' => $username,
                'first_name' => $firstName,
                'last_name' => $lastName,
            ]
        );

        // Try to link user by telegram_username
        if (!$chat->chatable_id && $username) {
            $user = User::where('telegram_username', $username)->first();
            if ($user) {
                $chat->chatable()->associate($user);
                $chat->save();
            }
        }

        switch ($text) {
            case '/start':
                $this->handleStart($chatId, $chat);
                break;

            case '/help':
                $this->handleHelp($chatId);
                break;

            case '/balance':
            case '/rates':
            case '/status':
                $this->handleMiniApp($chatId);
                break;

            case '/support':
                $this->handleSupport($chatId, $chat);
                break;

            case '/tickets':
                $this->handleTickets($chatId, $chat);
                break;

            case '/unlink':
                $this->handleUnlink($chatId, $chat);
                break;

            default:
                if ($bot->type === 'support') {
                    $this->handleSupportMessage($chatId, $text, $chat);
                } else {
                    $this->botService->sendMessage($chatId, "Неизвестная команда. Используйте /help для списка команд.");
                }
                break;
        }
    }

    protected function handleCallbackQuery(array $callbackQuery, TelegramBot $bot)
    {
        $this->botService->answerCallbackQuery($callbackQuery['id']);
        $data = $callbackQuery['data'];
        $chatId = $callbackQuery['message']['chat']['id'];
        $messageId = $callbackQuery['message']['message_id'];

        if (str_starts_with($data, 'ticket_close_')) {
            $ticketId = (int) str_replace('ticket_close_', '', $data);
            $ticket = SupportTicket::find($ticketId);
            if ($ticket) {
                $ticket->status = 3;
                $ticket->last_reply = Carbon::now();
                $ticket->save();
                $this->botService->editMessageText($chatId, $messageId, "Тикет #{$ticket->ticket} закрыт.");
            }
        }
    }

    protected function handleStart(string $chatId, TelegramBotChat $chat)
    {
        $welcome = "👋 Добро пожаловать в <b>Solidus Exchange</b>!\n\n";

        if ($chat->chatable) {
            $welcome .= "✅ Ваш аккаунт связан: " . optional($chat->chatable)->username . "\n\n";
        } else {
            $welcome .= "⚠️ Аккаунт не связан. Свяжите его в профиле на сайте или в Mini App.\n\n";
        }

        $welcome .= "📱 <b>Доступные команды:</b>\n";
        $welcome .= "/rates — курсы обмена\n";
        $welcome .= "/support — написать в поддержку\n";
        $welcome .= "/tickets — мои тикеты\n";
        $welcome .= "/unlink — отвязать аккаунт\n";
        $welcome .= "/help — помощь\n\n";
        $welcome .= "🚀 Откройте Mini App для обмена:";

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => '🚀 Открыть Mini App', 'web_app' => ['url' => config('app.url') . '/telegram/mini-app']]
                ]
            ]
        ];

        $this->botService->sendMessage($chatId, $welcome, $keyboard);
    }

    protected function handleHelp(string $chatId)
    {
        $help = "<b>🤖 Команды бота Solidus Exchange:</b>\n\n";
        $help .= "/start — Главное меню\n";
        $help .= "/rates — Текущие курсы валют\n";
        $help .= "/support — Связаться с поддержкой\n";
        $help .= "/tickets — Мои обращения в поддержку\n";
        $help .= "/unlink — Отвязать Telegram от аккаунта\n";
        $help .= "/help — Эта справка\n\n";
        $help .= "💬 Для обмена откройте Mini App через кнопку ниже.";

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => '🚀 Открыть Mini App', 'web_app' => ['url' => config('app.url') . '/telegram/mini-app']]
                ]
            ]
        ];

        $this->botService->sendMessage($chatId, $help, $keyboard);
    }

    protected function handleMiniApp(string $chatId)
    {
        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => '🚀 Открыть Mini App', 'web_app' => ['url' => config('app.url') . '/telegram/mini-app']]
                ]
            ]
        ];

        $this->botService->sendMessage($chatId, "Нажмите кнопку ниже, чтобы открыть Mini App:", $keyboard);
    }

    protected function handleSupport(string $chatId, TelegramBotChat $chat)
    {
        if (!$chat->chatable) {
            $this->botService->sendMessage($chatId, "⚠️ Сначала свяжите ваш аккаунт. Откройте Mini App и авторизуйтесь.");
            return;
        }

        $this->botService->sendMessage($chatId, "✍️ Напишите ваше сообщение, и мы создадим тикет в поддержку. Ответим в ближайшее время!");
    }

    protected function handleSupportMessage(string $chatId, string $text, TelegramBotChat $chat)
    {
        if (!$chat->chatable) {
            $this->botService->sendMessage($chatId, "⚠️ Аккаунт не связан. Используйте /start.");
            return;
        }

        $user = $chat->chatable;

        DB::beginTransaction();
        try {
            $ticket = SupportTicket::create([
                'user_id' => $user->id,
                'ticket' => rand(100000, 999999),
                'subject' => Str::limit($text, 50),
                'status' => 0,
                'last_reply' => Carbon::now(),
            ]);

            SupportTicketMessage::create([
                'support_ticket_id' => $ticket->id,
                'message' => $text,
            ]);

            DB::commit();

            $reply = "✅ <b>Тикет создан!</b>\n";
            $reply .= "🎫 Номер: <b>#{$ticket->ticket}</b>\n";
            $reply .= "📌 Тема: {$ticket->subject}\n";
            $reply .= "⏳ Статус: <i>В ожидании ответа</i>\n\n";
            $reply .= "Мы ответим вам здесь, как только обработаем запрос.";

            $keyboard = [
                'inline_keyboard' => [
                    [
                        ['text' => '📋 Мои тикеты', 'callback_data' => 'my_tickets']
                    ]
                ]
            ];

            $this->botService->sendMessage($chatId, $reply, $keyboard);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Telegram support ticket error', ['error' => $e->getMessage()]);
            $this->botService->sendMessage($chatId, "❌ Ошибка создания тикета. Попробуйте позже.");
        }
    }

    protected function handleTickets(string $chatId, TelegramBotChat $chat)
    {
        if (!$chat->chatable) {
            $this->botService->sendMessage($chatId, "⚠️ Аккаунт не связан.");
            return;
        }

        $tickets = SupportTicket::where('user_id', $chat->chatable->id)
            ->orderBy('id', 'desc')
            ->limit(10)
            ->get();

        if ($tickets->isEmpty()) {
            $this->botService->sendMessage($chatId, "📭 У вас пока нет обращений в поддержку.");
            return;
        }

        $message = "<b>📋 Ваши тикеты:</b>\n\n";
        foreach ($tickets as $ticket) {
            $status = match ($ticket->status) {
                0 => '🟡 Открыт',
                1 => '🟢 Отвечен',
                2 => '🔵 Ответ клиента',
                3 => '🔴 Закрыт',
                default => '⚪',
            };
            $message .= "#{$ticket->ticket} — {$status}\n";
            $message .= "<i>{$ticket->subject}</i>\n\n";
        }

        $this->botService->sendMessage($chatId, $message);
    }

    protected function handleUnlink(string $chatId, TelegramBotChat $chat)
    {
        if ($chat->chatable) {
            $chat->chatable->update(['telegram_id' => null, 'telegram_username' => null]);
            $chat->chatable()->dissociate();
            $chat->save();
        }

        $this->botService->sendMessage($chatId, "✅ Telegram отвязан от вашего аккаунта.");
    }
}
