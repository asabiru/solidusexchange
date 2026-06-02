<?php

namespace App\Console\Commands;

use App\Models\TelegramBot;
use App\Services\Telegram\TelegramBotService;
use Illuminate\Console\Command;

class TelegramSetWebhook extends Command
{
    protected $signature = 'telegram:webhook {bot_id?}';
    protected $description = 'Set webhook for Telegram bot(s)';

    public function handle()
    {
        $botId = $this->argument('bot_id');

        if ($botId) {
            $bots = TelegramBot::where('id', $botId)->get();
        } else {
            $bots = TelegramBot::where('is_active', true)->get();
        }

        if ($bots->isEmpty()) {
            $this->error('No active bots found.');
            return 1;
        }

        $service = app(TelegramBotService::class);

        foreach ($bots as $bot) {
            $result = $service->setBot($bot)->setWebhook($bot->webhook_url);

            if ($result['ok'] ?? false) {
                $this->info("Webhook set for bot: {$bot->name}");
            } else {
                $this->error("Failed for {$bot->name}: " . ($result['description'] ?? 'Unknown error'));
            }
        }

        return 0;
    }
}
