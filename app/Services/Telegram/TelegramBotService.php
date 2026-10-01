<?php

namespace App\Services\Telegram;

use App\Models\TelegramBot;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TelegramBotService
{
    protected string $token;
    protected string $apiUrl = 'https://api.telegram.org/bot';

    public function __construct(string $token = null)
    {
        $this->token = $token ?? config('services.telegram.bot_token');
    }

    public function setBot(TelegramBot $bot): self
    {
        $this->token = $bot->bot_token;
        return $this;
    }

    public function sendMessage(string $chatId, string $text, array $replyMarkup = null, string $parseMode = 'HTML'): array
    {
        $payload = [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => $parseMode,
        ];

        if ($replyMarkup) {
            $payload['reply_markup'] = json_encode($replyMarkup);
        }

        return $this->request('sendMessage', $payload);
    }

    public function sendPhoto(string $chatId, string $photo, string $caption = null, array $replyMarkup = null): array
    {
        $payload = [
            'chat_id' => $chatId,
            'photo' => $photo,
            'parse_mode' => 'HTML',
        ];

        if ($caption) {
            $payload['caption'] = $caption;
        }

        if ($replyMarkup) {
            $payload['reply_markup'] = json_encode($replyMarkup);
        }

        return $this->request('sendPhoto', $payload);
    }

    public function setWebhook(string $url, string $secretToken = null): array
    {
        $payload = [
            'url' => $url,
            'max_connections' => 40,
            'allowed_updates' => json_encode(['message', 'callback_query', 'inline_query']),
        ];

        if ($secretToken) {
            $payload['secret_token'] = $secretToken;
        }

        return $this->request('setWebhook', $payload);
    }

    public function deleteWebhook(): array
    {
        return $this->request('deleteWebhook', []);
    }

    public function getWebhookInfo(): array
    {
        return $this->request('getWebhookInfo', []);
    }

    public function getMe(): array
    {
        return $this->request('getMe', []);
    }

    public function answerCallbackQuery(string $callbackQueryId, string $text = null): array
    {
        $payload = [
            'callback_query_id' => $callbackQueryId,
        ];

        if ($text) {
            $payload['text'] = $text;
        }

        return $this->request('answerCallbackQuery', $payload);
    }

    public function editMessageText(string $chatId, int $messageId, string $text, array $replyMarkup = null): array
    {
        $payload = [
            'chat_id' => $chatId,
            'message_id' => $messageId,
            'text' => $text,
            'parse_mode' => 'HTML',
        ];

        if ($replyMarkup) {
            $payload['reply_markup'] = json_encode($replyMarkup);
        }

        return $this->request('editMessageText', $payload);
    }

    protected function request(string $method, array $payload): array
    {
        try {
            $url = $this->apiUrl . $this->token . '/' . $method;
            $response = Http::timeout(30)->post($url, $payload);

            if ($response->successful()) {
                return $response->json();
            }

            Log::error('Telegram API error', [
                'method' => $method,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return ['ok' => false, 'description' => $response->body()];
        } catch (\Exception $e) {
            Log::error('Telegram API exception', [
                'method' => $method,
                'error' => $e->getMessage(),
            ]);

            return ['ok' => false, 'description' => $e->getMessage()];
        }
    }
}
