<?php

namespace App\Services\CryptoMethod\crypto_cloud;

use App\Library\CryptoCloud;
use App\Models\CryptoMethod;
use App\Traits\CryptoWalletGenerate;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use RuntimeException;

class Service
{
    use CryptoWalletGenerate;

    private const SUPPORTED_CODES = [
        'BTC',
        'LTC',
        'TRX',
        'SOL',
        'BNB',
        'TON',
        'ETH',
        'ETH_ARB',
        'ETH_BASE',
        'ETH_OPT',
        'USDT_TRC20',
        'USDD_TRC20',
        'USDT_ERC20',
        'USDC_ERC20',
        'TUSD_ERC20',
        'SHIB_ERC20',
        'USDT_ARB',
        'USDC_ARB',
        'USDT_OPT',
        'USDC_OPT',
        'USDC_BASE',
        'USDT_BSC',
        'USDC_BSC',
        'TUSD_BSC',
        'USDT_SOL',
        'USDC_SOL',
        'DAI_ARB',
        'DAI_BASE',
        'DAI_BSC',
        'DAI_ERC20',
        'DAI_OPT',
        'PYUSD_ERC20',
        'PYUSD_SOL',
        'XAUT_ERC20',
        'ARB_ARB',
        'OP_OPT',
        'PEPE_BSC',
        'PEPE_ERC20',
        'SHIB_BSC',
        'TRUMP_SOL',
        'USDT_TON',
    ];

    private const STATIC_WALLET_UNSUPPORTED_CODES = [
        'TON',
        'USDT_TON',
    ];

    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        $providerCode = $this->resolveProviderCode($activeMethod, $cryptoCode);

        if (in_array($providerCode, self::STATIC_WALLET_UNSUPPORTED_CODES, true)) {
            throw new RuntimeException("CryptoCloud static wallet is not available for {$providerCode}. Set another currency mapping or use manual method for this coin.");
        }

        $client = $this->makeClient($activeMethod);
        $identify = $context['identifier'] ?? uniqid(Str::lower($type) . '_', true);
        $response = $client->createStaticWallet($providerCode, $identify);
        $wallet = $response['result'] ?? [];

        if (!($wallet['enable'] ?? false) && !empty($wallet['uuid'])) {
            $subscription = $client->subscribeStaticWallet($wallet['uuid']);
            $wallet = array_merge($wallet, $subscription['result'] ?? []);
        }

        $address = Arr::get($wallet, 'address');

        if (empty($address)) {
            throw new RuntimeException('CryptoCloud did not return a deposit address.');
        }

        return $address;
    }

    public function webhookUpdate($request, $object, $cryptoMethod, $type)
    {
        if (!$object) {
            return 'ok';
        }

        $client = $this->makeClient($cryptoMethod);
        if (!$client->verifyPostback($request->input('token'))) {
            return 'invalid signature';
        }

        if ($request->input('status') !== 'success') {
            return 'ok';
        }

        $sendAmount = (float)$request->input('amount_crypto', 0);

        if ($sendAmount >= (float)$object->send_amount) {
            $this->walletUpgration($object, $type, [
                'deposit_amount' => $sendAmount,
                'deposit_tx_id' => $request->input('txid') ?? $request->input('tx_hash'),
            ]);
        }

        return 'ok';
    }

    public function withdrawCrypto($object, $amount, $currency, $address, $type)
    {
        $method = optional($object->cryptoMethod);
        if (!$method) {
            $method = CryptoMethod::where('code', 'crypto_cloud')->firstOrFail();
        }

        $providerCode = $this->resolveProviderCode($method, $currency);
        $client = $this->makeClient($method);
        $orderId = trim(($object->utr ?? uniqid('cc_out_', true)) . '_' . $type);
        $response = $client->createPayout($providerCode, $address, (float)$amount, $orderId);

        return ($response['status'] ?? null) === 'success';
    }

    private function makeClient($method): CryptoCloud
    {
        $apiKey = trim((string)($method->parameters->api_key ?? ''));
        $shopId = trim((string)($method->parameters->shop_id ?? ''));

        if ($apiKey === '' || $shopId === '') {
            throw new RuntimeException('Configure CryptoCloud api_key and shop_id before activating the method.');
        }

        $client = new CryptoCloud();
        $client->setup(
            $apiKey,
            $shopId,
            trim((string)($method->parameters->secret_key ?? '')),
            trim((string)($method->parameters->payout_api_key ?? ''))
        );

        return $client;
    }

    private function resolveProviderCode($method, string $projectCode): string
    {
        $projectCode = Str::upper(trim($projectCode));
        $currencyMap = $this->parseCurrencyMap($method->parameters->currency_map ?? null);

        if (isset($currencyMap[$projectCode])) {
            $mappedCode = Str::upper(trim($currencyMap[$projectCode]));
            if (in_array($mappedCode, self::SUPPORTED_CODES, true)) {
                return $mappedCode;
            }

            throw new RuntimeException("CryptoCloud currency_map contains unsupported code [{$mappedCode}] for [{$projectCode}].");
        }

        if (in_array($projectCode, self::SUPPORTED_CODES, true)) {
            return $projectCode;
        }

        throw new RuntimeException("CryptoCloud does not support project currency [{$projectCode}] directly. Add it to currency_map, for example USDT=USDT_TRC20.");
    }

    private function parseCurrencyMap($rawValue): array
    {
        if (is_object($rawValue)) {
            return array_change_key_case((array)$rawValue, CASE_UPPER);
        }

        if (is_array($rawValue)) {
            return array_change_key_case($rawValue, CASE_UPPER);
        }

        $rawValue = trim((string)$rawValue);
        if ($rawValue === '') {
            return [];
        }

        if (Str::startsWith($rawValue, '{')) {
            $decoded = json_decode($rawValue, true);
            if (is_array($decoded)) {
                return array_change_key_case($decoded, CASE_UPPER);
            }
        }

        $map = [];
        foreach (preg_split('/[\r\n,]+/', $rawValue) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }

            $parts = preg_split('/\s*[:=]\s*/', $line, 2);
            if (count($parts) !== 2) {
                continue;
            }

            $map[Str::upper(trim($parts[0]))] = Str::upper(trim($parts[1]));
        }

        return $map;
    }
}
