<?php

namespace App\Services\Telegram;

use App\Models\User;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

class TelegramMiniAppAuthService
{
    public function validateInitData(string $initData): array
    {
        parse_str($initData, $data);

        $hash = (string) Arr::pull($data, 'hash', '');
        if ($hash === '') {
            throw new RuntimeException('Telegram init data hash is missing.');
        }

        ksort($data);
        $checkString = collect($data)
            ->map(fn($value, $key) => $key . '=' . $value)
            ->implode("\n");

        $secret = hash_hmac('sha256', (string) config('services.telegram.bot_token'), 'WebAppData', true);
        $calculatedHash = hash_hmac('sha256', $checkString, $secret);

        if (!hash_equals($calculatedHash, $hash)) {
            throw new RuntimeException('Telegram init data signature is invalid.');
        }

        return $data;
    }

    public function syncUser(array $initData): User
    {
        $telegramUser = json_decode((string) ($initData['user'] ?? '{}'), true) ?: [];
        $telegramId = (string) ($telegramUser['id'] ?? '');
        if ($telegramId === '') {
            throw new RuntimeException('Telegram user id is missing.');
        }

        return User::updateOrCreate(
            ['telegram_id' => $telegramId],
            [
                'provider' => 'telegram',
                'provider_id' => $telegramId,
                'username' => $telegramUser['username'] ?? 'tg_' . $telegramId,
                'telegram_username' => $telegramUser['username'] ?? null,
                'firstname' => $telegramUser['first_name'] ?? null,
                'lastname' => $telegramUser['last_name'] ?? null,
                'email' => 'tg_' . $telegramId . '@telegram.local',
                'password' => Hash::make(Str::random(32)),
                'telegram_auth_date' => isset($initData['auth_date']) ? date('Y-m-d H:i:s', (int) $initData['auth_date']) : now(),
                'telegram_payload' => $initData,
                'email_verification' => 1,
                'sms_verification' => 1,
            ]
        );
    }
}
