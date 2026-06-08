<?php

namespace App\Services\Kyc\Contracts;

use App\Models\Kyc;
use App\Models\User;
use Illuminate\Http\Request;

interface KycProviderInterface
{
    public function startSession(User $user, Kyc $kyc): array;

    public function handleWebhook(Request $request): array;

    public function providerName(): string;
}
