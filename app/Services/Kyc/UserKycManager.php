<?php

namespace App\Services\Kyc;

use App\Models\User;
use App\Models\UserKyc;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;

class UserKycManager
{
    private const PROFILE_FIELD_ALIASES = [
        'firstname' => ['firstname', 'first_name', 'first name', 'given_name', 'given name', 'forename'],
        'lastname' => ['lastname', 'last_name', 'last name', 'surname', 'family_name', 'family name'],
        'phone' => ['phone', 'phone_number', 'phone number', 'mobile', 'mobile_number', 'mobile number', 'telephone'],
        'phone_code' => ['phone_code', 'phone code', 'dial_code', 'dial code', 'country_dial_code'],
        'document_number' => ['document_number', 'document number', 'document_id', 'document id', 'id_number', 'id number', 'doc_number', 'doc number', 'passport_number', 'passport number'],
        'address' => ['address', 'address_one', 'address one', 'address1', 'address 1', 'street', 'street_address', 'address_line_1', 'line1'],
        'address_two' => ['address_two', 'address two', 'address2', 'address 2', 'address_line_2', 'line2', 'sub_street', 'sub street', 'flat', 'flat_number', 'flat number', 'apartment', 'suite'],
        'city' => ['city', 'town'],
        'country' => ['country', 'country_name', 'country name'],
        'country_code' => ['country_code', 'country code'],
        'zip_code' => ['zip', 'zip_code', 'zip code', 'zipcode', 'postal_code', 'postal code', 'postcode', 'post code'],
    ];

    public function refreshUserVerificationStatus(User $user): void
    {
        $status = 0;

        if ($user->userKycs()->where('status', 1)->exists()) {
            $status = 2;
        } elseif ($user->userKycs()->where('status', 0)->exists()) {
            $status = 1;
        } elseif ($user->userKycs()->where('status', 2)->exists()) {
            $status = 3;
        }

        if ((int) $user->identity_verify !== $status) {
            $user->forceFill(['identity_verify' => $status])->save();
        }
    }

    public function syncApprovedKycToProfile(UserKyc $userKyc): void
    {
        $user = $userKyc->user;
        if (!$user || (int) $userKyc->status !== 1) {
            return;
        }

        $profileData = $this->extractProfileData($userKyc);
        if ($profileData === []) {
            return;
        }

        $updates = [];

        foreach (['firstname', 'lastname', 'document_number', 'address', 'address_two', 'city', 'country', 'country_code', 'zip_code'] as $field) {
            if (!empty($profileData[$field])) {
                $updates[$field] = $profileData[$field];
            }
        }

        if (empty($user->phone) && !empty($profileData['phone'])) {
            $updates['phone'] = $profileData['phone'];
        }

        if (empty($user->phone_code) && !empty($profileData['phone_code'])) {
            $updates['phone_code'] = $profileData['phone_code'];
        }

        if ($updates !== []) {
            $user->forceFill($updates)->save();
        }
    }

    public function buildKycInfoFromSumsubApplicant(array $applicant): array
    {
        $info = $this->asArray($applicant['info'] ?? []);
        $fixedInfo = $this->asArray($applicant['fixedInfo'] ?? []);

        $address = $this->resolveApplicantAddress($info, $fixedInfo);
        $country = $this->resolveCountryName(
            $address['country'] ?? $info['country'] ?? $fixedInfo['country'] ?? null
        );
        $countryCode = $this->resolveCountryCode(
            $address['country'] ?? $info['country'] ?? $fixedInfo['country'] ?? null
        );

        $phone = $this->sanitizePhone($info['phone'] ?? $fixedInfo['phone'] ?? $this->firstNonEmpty($info['phoneNumbers'] ?? []));
        $addressLineOne = $this->joinAddressParts([
            $address['street'] ?? null,
            $address['streetEn'] ?? null,
            $address['buildingNumber'] ?? null,
        ]);
        $addressLineTwo = $this->joinAddressParts([
            $address['subStreet'] ?? null,
            $address['flatNumber'] ?? null,
            $address['state'] ?? null,
        ]);

        $fields = [
            'first_name' => $this->firstNonEmpty([$fixedInfo['firstName'] ?? null, $info['firstName'] ?? null]),
            'last_name' => $this->firstNonEmpty([$fixedInfo['lastName'] ?? null, $info['lastName'] ?? null]),
            'phone' => $phone,
            'document_number' => $this->resolveDocumentNumber($info, $fixedInfo),
            'address' => $addressLineOne,
            'address_two' => $addressLineTwo,
            'city' => $this->firstNonEmpty([$address['town'] ?? null, $address['city'] ?? null]),
            'country' => $country,
            'country_code' => $countryCode,
            'zip_code' => $this->firstNonEmpty([$address['postCode'] ?? null, $address['zipCode'] ?? null]),
        ];

        if ($this->containsMockIdentityData($fields)) {
            return [];
        }

        $kycInfo = [];
        foreach ($fields as $key => $value) {
            $value = is_string($value) ? trim($value) : $value;
            if ($value === null || $value === '') {
                continue;
            }

            $kycInfo[$key] = [
                'field_name' => $key,
                'field_label' => Str::headline($key),
                'field_value' => $value,
                'type' => 'text',
                'validation' => 'optional',
            ];
        }

        return $kycInfo;
    }

    private function extractProfileData(UserKyc $userKyc): array
    {
        $kycInfo = $this->normalizeKycInfo($userKyc->kyc_info);

        // Legacy: try to extract profile from applicant payload (previously used for Sumsub)
        if ($kycInfo === []) {
            $applicant = $this->asArray(data_get($userKyc->provider_payload, 'applicant', []));
            if ($applicant !== []) {
                $kycInfo = $this->normalizeKycInfo($this->buildKycInfoFromSumsubApplicant($applicant));
            }
        }

        $profileData = [];
        foreach ($kycInfo as $item) {
            if (($item['type'] ?? null) === 'file') {
                continue;
            }

            $value = trim((string) ($item['field_value'] ?? ''));
            if ($value === '') {
                continue;
            }

            $attribute = $this->resolveProfileAttribute([
                $item['field_name'] ?? null,
                $item['field_label'] ?? null,
            ]);

            if (!$attribute || isset($profileData[$attribute])) {
                continue;
            }

            $profileData[$attribute] = match ($attribute) {
                'country' => $this->resolveCountryName($value),
                'country_code' => $this->resolveCountryCode($value),
                'phone_code' => $this->normalizePhoneCode($value),
                'phone' => $this->sanitizePhone($value),
                default => $value,
            };
        }

        if (!empty($profileData['country']) && empty($profileData['country_code'])) {
            $profileData['country_code'] = $this->resolveCountryCode($profileData['country']);
        }

        if (!empty($profileData['country_code']) && empty($profileData['country'])) {
            $profileData['country'] = $this->resolveCountryName($profileData['country_code']);
        }

        if ($this->containsMockIdentityData($profileData)) {
            return [];
        }

        return array_filter($profileData, static fn($value) => $value !== null && $value !== '');
    }

    private function resolveProfileAttribute(array $candidates): ?string
    {
        $normalizedCandidates = collect($candidates)
            ->filter()
            ->map(fn($candidate) => $this->normalizeKey((string) $candidate))
            ->filter()
            ->unique();

        foreach (self::PROFILE_FIELD_ALIASES as $attribute => $aliases) {
            $normalizedAliases = collect($aliases)
                ->map(fn($alias) => $this->normalizeKey($alias))
                ->all();

            if ($normalizedCandidates->contains(fn($candidate) => in_array($candidate, $normalizedAliases, true))) {
                return $attribute;
            }
        }

        return null;
    }

    private function normalizeKycInfo(mixed $kycInfo): array
    {
        $items = [];

        foreach ((array) $kycInfo as $item) {
            $item = $this->asArray($item);
            if ($item === []) {
                continue;
            }

            $items[] = [
                'field_name' => $item['field_name'] ?? null,
                'field_label' => $item['field_label'] ?? null,
                'field_value' => $item['field_value'] ?? null,
                'type' => $item['type'] ?? 'text',
            ];
        }

        return $items;
    }

    private function resolveApplicantAddress(array $info, array $fixedInfo): array
    {
        $addresses = Arr::wrap($info['addresses'] ?? $fixedInfo['addresses'] ?? []);
        foreach ($addresses as $address) {
            $address = $this->asArray($address);
            if ($address !== []) {
                return $address;
            }
        }

        return $this->asArray($info['address'] ?? $fixedInfo['address'] ?? []);
    }

    private function resolveDocumentNumber(array $info, array $fixedInfo): ?string
    {
        foreach ([$fixedInfo, $info] as $source) {
            $documents = Arr::wrap($source['idDocs'] ?? []);
            foreach ($documents as $document) {
                $document = $this->asArray($document);
                $number = trim((string) ($document['number'] ?? $document['idNumber'] ?? $document['docNumber'] ?? ''));
                if ($number !== '') {
                    return $number;
                }
            }
        }

        return null;
    }

    private function containsMockIdentityData(array $fields): bool
    {
        foreach (['first_name', 'last_name', 'document_number', 'firstname', 'lastname'] as $key) {
            $value = trim((string) ($fields[$key] ?? ''));
            if ($value !== '' && $this->isMockValue($value)) {
                return true;
            }
        }

        return false;
    }

    private function isMockValue(string $value): bool
    {
        $normalized = Str::lower(trim($value));

        return Str::startsWith($normalized, 'mock-')
            || Str::startsWith($normalized, 'mock ')
            || Str::contains($normalized, 'mock-doe');
    }

    private function joinAddressParts(array $parts): ?string
    {
        $parts = collect($parts)
            ->map(fn($value) => is_string($value) ? trim($value) : null)
            ->filter()
            ->unique()
            ->values()
            ->all();

        return $parts === [] ? null : implode(', ', $parts);
    }

    private function resolveCountryName(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        foreach (config('country', []) as $country) {
            if (!is_array($country)) {
                continue;
            }

            if (strcasecmp((string) ($country['name'] ?? ''), $value) === 0 || strcasecmp((string) ($country['code'] ?? ''), $value) === 0) {
                return (string) ($country['name'] ?? $value);
            }
        }

        return Str::length($value) <= 3 ? strtoupper($value) : $value;
    }

    private function resolveCountryCode(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        foreach (config('country', []) as $country) {
            if (!is_array($country)) {
                continue;
            }

            if (strcasecmp((string) ($country['name'] ?? ''), $value) === 0 || strcasecmp((string) ($country['code'] ?? ''), $value) === 0) {
                return strtoupper((string) ($country['code'] ?? ''));
            }
        }

        return Str::length($value) === 2 ? strtoupper($value) : null;
    }

    private function normalizePhoneCode(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $digits = preg_replace('/[^\d]/', '', $value);
        if ($digits === '') {
            return null;
        }

        return '+' . $digits;
    }

    private function sanitizePhone(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        return preg_replace('/\s+/', '', $value);
    }

    private function normalizeKey(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->replace(['-', '/', '\\'], ' ')
            ->replaceMatches('/[^a-z0-9]+/', '_')
            ->trim('_');
    }

    private function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            $value = is_string($value) ? trim($value) : null;
            if ($value !== null && $value !== '') {
                return $value;
            }
        }

        return null;
    }

    private function asArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_object($value)) {
            return (array) $value;
        }

        return [];
    }
}
