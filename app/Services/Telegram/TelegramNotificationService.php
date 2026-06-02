<?php

namespace App\Services\Telegram;

use App\Models\Admin;
use App\Models\SupportTicket;
use App\Models\TelegramBot;
use App\Models\TelegramBotChat;
use App\Models\User;

class TelegramNotificationService
{
    protected TelegramBotService $botService;

    public function __construct(TelegramBotService $botService)
    {
        $this->botService = $botService;
    }

    /**
     * Notify support agents about a new ticket
     */
    public function notifyNewTicket(SupportTicket $ticket): void
    {
        $supportBot = TelegramBot::where('type', 'support')->where('is_active', true)->first();
        if (!$supportBot) {
            return;
        }

        $this->botService->setBot($supportBot);

        $user = $ticket->user;
        $text = "🎫 <b>Новый тикет</b>\n";
        $text .= "Номер: <b>#{$ticket->ticket}</b>\n";
        $text .= "Пользователь: " . optional($user)->username . "\n";
        $text .= "Тема: {$ticket->subject}\n";
        $text .= "⏰ " . $ticket->created_at->format('d.m.Y H:i') . "\n";

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => 'Открыть в панели', 'url' => route('admin.support.ticket.view', $ticket->id)]
                ]
            ]
        ];

        // Send to all support agents with linked Telegram
        $chats = TelegramBotChat::where('telegram_bot_id', $supportBot->id)
            ->whereHas('chatable', function ($query) {
                $query->where('role', 'support');
            })
            ->get();

        foreach ($chats as $chat) {
            $this->botService->sendMessage($chat->chat_id, $text, $keyboard);
        }
    }

    /**
     * Notify user about ticket reply
     */
    public function notifyTicketReply(SupportTicket $ticket, string $replyText): void
    {
        $user = $ticket->user;
        if (!$user || !$user->telegram_id) {
            return;
        }

        // Find bot that user is chatting with
        $chat = TelegramBotChat::where('chatable_id', $user->id)
            ->where('chatable_type', User::class)
            ->first();

        if (!$chat) {
            return;
        }

        $this->botService->setBot($chat->bot);

        $text = "📨 <b>Ответ на тикет #{$ticket->ticket}</b>\n";
        $text .= "Тема: {$ticket->subject}\n\n";
        $text .= $replyText . "\n\n";
        $text .= "⏰ " . now()->format('d.m.Y H:i');

        $keyboard = [
            'inline_keyboard' => [
                [
                    ['text' => 'Ответить', 'url' => route('user.ticket.view', $ticket->ticket)]
                ]
            ]
        ];

        $this->botService->sendMessage($chat->chat_id, $text, $keyboard);
    }

    /**
     * Notify user about new ticket created from Telegram
     */
    public function notifyUserTicketCreated(SupportTicket $ticket, string $chatId, TelegramBot $bot): void
    {
        $this->botService->setBot($bot);

        $text = "✅ <b>Тикет создан!</b>\n";
        $text .= "🎫 Номер: <b>#{$ticket->ticket}</b>\n";
        $text .= "📌 Тема: {$ticket->subject}\n";
        $text .= "⏳ Статус: <i>В ожидании ответа</i>\n\n";
        $text .= "Мы ответим вам здесь, как только обработаем запрос.";

        $this->botService->sendMessage($chatId, $text);
    }
}
