<?php

namespace App\Services\Telegram;

use App\Models\User;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
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

    public function syncUser(array $initData, ?User $currentUser = null): User
    {
        $telegramUser = json_decode((string) ($initData['user'] ?? '{}'), true) ?: [];
        $telegramId = (string) ($telegramUser['id'] ?? '');
        if ($telegramId === '') {
            throw new RuntimeException('Telegram user id is missing.');
        }

        $existingUser = User::where('telegram_id', $telegramId)->first();
        if (!$existingUser && Schema::hasColumn('users', 'provider_id')) {
            $existingUser = User::where('provider', 'telegram')->where('provider_id', $telegramId)->first();
        }

        $user = $existingUser ?: $currentUser ?: new User();
        $user->forceFill($this->telegramUserAttributes($telegramId, $telegramUser, $initData, !$user->exists));
        $user->save();

        return $user;
    }

    private function telegramUserAttributes(string $telegramId, array $telegramUser, array $initData, bool $isNewUser): array
    {
        $username = $telegramUser['username'] ?? null;

        $attributes = [
            'telegram_id' => $telegramId,
            'telegram_username' => $username,
            'telegram_auth_date' => isset($initData['auth_date']) ? date('Y-m-d H:i:s', (int) $initData['auth_date']) : now(),
            'telegram_linked_at' => now(),
            'telegram_payload' => $initData,
            'telegram_notifications_enabled' => true,
            'username' => $username ?: 'tg_' . $telegramId,
            'firstname' => $telegramUser['first_name'] ?? null,
            'lastname' => $telegramUser['last_name'] ?? null,
        ];

        if (Schema::hasColumn('users', 'provider')) {
            $attributes['provider'] = 'telegram';
        }

        if (Schema::hasColumn('users', 'provider_id')) {
            $attributes['provider_id'] = $telegramId;
        }

        if ($isNewUser) {
            $attributes['email'] = 'tg_' . $telegramId . '@telegram.local';
            $attributes['password'] = Hash::make(Str::random(32));
            $attributes['email_verification'] = 1;
            $attributes['sms_verification'] = 1;
        }

        return $attributes;
    }
}
