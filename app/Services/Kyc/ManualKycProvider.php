<?php

namespace App\Services\Kyc;

use App\Models\Kyc;
use App\Models\User;
use App\Services\Kyc\Contracts\KycProviderInterface;
use Illuminate\Http\Request;
use RuntimeException;

class ManualKycProvider implements KycProviderInterface
{
    public function startSession(User $user, Kyc $kyc): array
    {
        throw new RuntimeException('Manual KYC uses the legacy form submission flow.');
    }

    public function handleWebhook(Request $request): array
    {
        return ['status' => 'ignored'];
    }

    public function providerName(): string
    {
        return 'manual';
    }
}
