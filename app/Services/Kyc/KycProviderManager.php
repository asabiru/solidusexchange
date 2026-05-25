<?php

namespace App\Services\Kyc;

use App\Services\Kyc\Contracts\KycProviderInterface;
use RuntimeException;

class KycProviderManager
{
    public function driver(?string $provider = null): KycProviderInterface
    {
        $provider = $provider ?: (string) config('compliance.kyc_provider', 'sumsub');

        return match ($provider) {
            'sumsub' => app(SumsubKycService::class),
            'manual' => app(ManualKycProvider::class),
            default => throw new RuntimeException("Unsupported KYC provider [{$provider}]."),
        };
    }
}
