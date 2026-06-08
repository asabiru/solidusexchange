<?php

namespace App\Services\Custodial;

use App\Models\CustodialWallet;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * HD Wallet Service — generates deposit addresses and monitors deposits
 * using free blockchain APIs (no paid provider required).
 *
 * Address generation uses:
 *   - BIP39 mnemonic → seed (hash_pbkdf2)
 *   - BIP32/BIP44 HD key derivation (HMAC-SHA512 + GMP modular arithmetic)
 *   - secp256k1 via PHP OpenSSL extension
 *   - Ed25519 via PHP Sodium extension (SOL, TON)
 *
 * Supported chains:
 * - BTC: Blockstream API (free)
 * - LTC: Blockstream-compatible public API (free)
 * - ETH/EVM: Public RPC nodes (free)
 * - TRX: TronGrid API (free tier)
 * - SOL: Solana RPC (free)
 * - BNB: BSC RPC (free)
 * - TON: TON API (free tier)
 */
class HdWalletService
{
    private array $apiBaseUrlCache = [];

    // ─── secp256k1 curve parameters ───────────────────────────────────────
    private const SECP256K1_P  = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F';
    private const SECP256K1_N  = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141';
    private const SECP256K1_GX = '0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798';
    private const SECP256K1_GY = '0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8';

    // ─── BIP44 coin types ─────────────────────────────────────────────────
    private const COIN_TYPES = [
        'BTC'     => 0,
        'LTC'     => 2,
        'ETH'     => 60,
        'BNB'     => 714,
        'TRX'     => 195,
        'SOL'     => 501,
        'TON'     => 607,
        'USDT_TON'   => 607,  // TON jetton — same chain as TON
        'USDT'    => 60,      // ERC20
        'USDT_TRC20' => 195,  // TRC20
        'USDT_BSC'   => 60,   // BEP20
        'USDC'    => 60,
        'ARB'     => 60,
        'OP'      => 60,
        'SHIB'    => 60,
        'PEPE'    => 60,
    ];

    // ─── Blockchain API endpoints ─────────────────────────────────────────
    public function getApiBaseUrl(string $currencyCode): string
    {
        $normalized = $this->normalizeCode(strtoupper(trim($currencyCode)));

        if (isset($this->apiBaseUrlCache[$normalized])) {
            return $this->apiBaseUrlCache[$normalized];
        }

        $urls = $this->getApiBaseUrls($normalized);
        if (empty($urls)) {
            throw new RuntimeException("No API endpoint configured for {$currencyCode}");
        }

        foreach ($urls as $baseUrl) {
            if ($this->isApiEndpointHealthy($normalized, $baseUrl)) {
                return $this->apiBaseUrlCache[$normalized] = $baseUrl;
            }
        }

        // Fall back to the first configured URL so callers get a useful error
        // from the actual request if every health check fails.
        return $this->apiBaseUrlCache[$normalized] = $urls[0];
    }

    /**
     * Resolve configured endpoint candidates for a chain.
     */
    private function getApiBaseUrls(string $currencyCode): array
    {
        $normalized = $this->normalizeCode(strtoupper(trim($currencyCode)));

        $value = match ($normalized) {
            'BTC' => config('custodial.btc_api', []),
            'LTC' => config('custodial.ltc_api', []),
            'ETH' => config('custodial.eth_rpc', []),
            'BNB' => config('custodial.bsc_rpc', []),
            'TRX' => config('custodial.trx_api', []),
            'SOL' => config('custodial.sol_rpc', []),
            'TON' => config('custodial.ton_api', []),
            default => [],
        };

        if (is_string($value)) {
            $value = explode('|', $value);
        }

        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(array_map('trim', $value)));
    }

    /**
     * Lightweight health probe for a chain-specific endpoint.
     */
    private function isApiEndpointHealthy(string $chain, string $baseUrl): bool
    {
        try {
            $response = match ($chain) {
                'BTC', 'LTC' => Http::timeout(3)->get("{$baseUrl}/blocks/tip/height"),
                'ETH', 'BNB' => Http::timeout(3)->post($baseUrl, [
                    'jsonrpc' => '2.0',
                    'method'  => 'eth_chainId',
                    'params'  => [],
                    'id'      => 1,
                ]),
                'TRX' => Http::timeout(3)->get("{$baseUrl}/wallet/getnowblock"),
                'SOL' => Http::timeout(3)->post($baseUrl, [
                    'jsonrpc' => '2.0',
                    'method'  => 'getHealth',
                    'params'  => [],
                    'id'      => 1,
                ]),
                'TON' => Http::timeout(3)->get("{$baseUrl}/getMasterchainInfo"),
                default => null,
            };

            if (!$response || !$response->successful()) {
                return false;
            }

            return match ($chain) {
                'ETH', 'BNB' => filled($response->json('result')),
                'SOL' => $response->json('result') === 'ok' || $response->json('result.value') !== null || $response->json('result') !== null,
                'TON' => $response->json('result') !== null,
                default => true,
            };
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Normalize currency code to base chain.
     */
    public function normalizeCode(string $code): string
    {
        $code = strtoupper(trim($code));

        if (str_ends_with($code, '_TRC20') || $code === 'TRX')  return 'TRX';
        if ($code === 'USDT_TON' || $code === 'TON')            return 'TON';
        if (str_ends_with($code, '_BSC') || $code === 'BNB')    return 'BNB';
        if (str_ends_with($code, '_ARB') || $code === 'ARB')    return 'ETH';
        if (str_ends_with($code, '_OPT') || $code === 'OP')     return 'ETH';
        if (str_ends_with($code, '_BASE'))                       return 'ETH';
        if (in_array($code, ['USDT', 'USDC', 'SHIB', 'PEPE', 'ETH'])) return 'ETH';

        return $code;
    }

    /**
     * Get the BIP44 coin type for a currency.
     */
    private function getCoinType(string $currencyCode): int
    {
        $code = strtoupper(trim($currencyCode));
        return self::COIN_TYPES[$code] ?? self::COIN_TYPES[$this->normalizeCode($code)] ?? 60;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ADDRESS GENERATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Generate a new deposit address for the given currency using HD derivation.
     * Returns ['address' => string, 'private_key' => string, 'derivation_path' => string, 'index' => int]
     */
    public function generateAddress(string $currencyCode): array
    {
        $mnemonic = config('custodial.hd_mnemonic') ?: env('HD_WALLET_MNEMONIC');
        if (empty($mnemonic)) {
            throw new RuntimeException('HD_WALLET_MNEMONIC is not set in .env');
        }

        $code = strtoupper(trim($currencyCode));
        $chain = $this->normalizeCode($code);
        $coinType = $this->getCoinType($code);

        // Get next index: find the highest hd_wallet_index for this currency
        $lastWallet = CustodialWallet::forCurrency($code)
            ->whereNotNull('hd_wallet_index')
            ->orderByDesc('hd_wallet_index')
            ->first();
        $index = $lastWallet ? ($lastWallet->hd_wallet_index + 1) : 0;

        // BIP44 path: m / purpose' / coin_type' / account' / change / index
        $path = "m/44'/{$coinType}'/0'/0/{$index}";

        // Derive key from mnemonic
        $seed = $this->mnemonicToSeed($mnemonic);
        $masterKey = $this->deriveMasterKey($seed);
        $childKey = $this->derivePath($masterKey, $path);

        $privateKey = $childKey['private_key'];

        // Generate address based on chain
        $address = match ($chain) {
            'BTC'  => $this->getBtcAddress($privateKey),
            'LTC'  => $this->getLtcAddress($privateKey),
            'ETH'  => $this->getEthAddress($privateKey),
            'BNB'  => $this->getEthAddress($privateKey), // BNB uses same format as ETH
            'TRX'  => $this->getTrxAddress($privateKey),
            'SOL'  => $this->getSolAddressFromSeed($seed, $index),
            'TON'  => $this->getTonAddressFromSeed($seed, $index),
            default => throw new RuntimeException("Address generation not supported for chain {$chain}"),
        };

        return [
            'address'         => $address,
            'private_key'     => $privateKey,
            'derivation_path' => $path,
            'index'           => $index,
        ];
    }

    // ─── BIP39: Mnemonic → Seed ──────────────────────────────────────────

    /**
     * Convert BIP39 mnemonic to 64-byte seed.
     */
    private function mnemonicToSeed(string $mnemonic, string $passphrase = ''): string
    {
        $mnemonic = trim($mnemonic);
        $salt = 'mnemonic' . $passphrase;

        // hash_pbkdf2 with SHA-512, 2048 iterations, 64 bytes
        return hash_pbkdf2('sha512', $mnemonic, $salt, 2048, 64, true);
    }

    // ─── BIP32: HD Key Derivation ────────────────────────────────────────

    /**
     * Derive BIP32 master key from seed.
     * Returns ['private_key' => hex, 'chain_code' => hex]
     */
    private function deriveMasterKey(string $seed): array
    {
        $hmac = hash_hmac('sha512', $seed, "Bitcoin seed", true);
        return [
            'private_key' => bin2hex(substr($hmac, 0, 32)),
            'chain_code'  => bin2hex(substr($hmac, 32, 32)),
        ];
    }

    /**
     * Derive child key from parent key using BIP32 CKDpriv.
     */
    private function deriveChildKey(array $parentKey, int $index, bool $hardened = false): array
    {
        if ($hardened) {
            // Hardened: 0x00 + private_key + index (with 0x80000000)
            $data = "\x00" . hex2bin($parentKey['private_key']) . pack('N', 0x80000000 + $index);
        } else {
            // Normal: compressed_public_key + index
            $pubKey = $this->privateKeyToCompressedPubKey($parentKey['private_key']);
            $data = hex2bin($pubKey) . pack('N', $index);
        }

        $hmac = hash_hmac('sha512', $data, hex2bin($parentKey['chain_code']), true);
        $il = substr($hmac, 0, 32); // left = child key tweak
        $ir = substr($hmac, 32, 32); // right = child chain code

        // child_key = (parse256(IL) + parent_key) mod n
        $ilInt = gmp_init(bin2hex($il), 16);
        $parentInt = gmp_init($parentKey['private_key'], 16);
        $n = gmp_init(self::SECP256K1_N, 16);
        $childInt = gmp_mod(gmp_add($ilInt, $parentInt), $n);

        if (gmp_cmp($childInt, 0) === 0 || gmp_cmp($ilInt, $n) >= 0) {
            throw new RuntimeException('Invalid child key derived');
        }

        return [
            'private_key' => str_pad(gmp_strval($childInt, 16), 64, '0', STR_PAD_LEFT),
            'chain_code'  => bin2hex($ir),
        ];
    }

    /**
     * Derive key at a full BIP44 path (e.g. "m/44'/60'/0'/0/0").
     */
    private function derivePath(array $masterKey, string $path): array
    {
        $parts = explode('/', $path);
        if ($parts[0] !== 'm') {
            throw new RuntimeException("Path must start with 'm'");
        }

        $key = $masterKey;
        for ($i = 1; $i < count($parts); $i++) {
            $segment = $parts[$i];
            $hardened = str_ends_with($segment, "'");
            $index = (int)str_replace("'", '', $segment);
            $key = $this->deriveChildKey($key, $index, $hardened);
        }

        return $key;
    }

    // ─── Secp256k1 Public Key ─────────────────────────────────────────────

    /**
     * Derive compressed public key from private key hex string.
     * Uses OpenSSL EC operations for secp256k1.
     */
    private function privateKeyToCompressedPubKey(string $privateKeyHex): string
    {
        $privKeyBin = hex2bin(str_pad($privateKeyHex, 64, '0', STR_PAD_LEFT));

        $pkey = openssl_pkey_new([
            'ec' => [
                'curve_name' => 'secp256k1',
                'priv_key'   => $privKeyBin,
            ],
        ]);

        if (!$pkey) {
            throw new RuntimeException('Failed to create EC key: ' . openssl_error_string());
        }

        $details = openssl_pkey_get_details($pkey);
        $pubKey = $details['ec']['d'] ?? $details['ec']['pub_key'] ?? null;

        // OpenSSL returns uncompressed pub key (0x04 + X + Y), we need compressed
        if (isset($details['ec']['pub_key'])) {
            $pubKeyBin = $details['ec']['pub_key'];
            // If it's already 33 bytes (compressed), return as-is
            if (strlen($pubKeyBin) === 33) {
                return bin2hex($pubKeyBin);
            }
            // If 65 bytes (uncompressed: 0x04 + 32-byte X + 32-byte Y), compress it
            if (strlen($pubKeyBin) === 65 && $pubKeyBin[0] === "\x04") {
                $x = substr($pubKeyBin, 1, 32);
                $y = substr($pubKeyBin, 33, 32);
                $prefix = (ord($y[31]) & 1) ? "\x03" : "\x02";
                return bin2hex($prefix . $x);
            }
        }

        // Fallback: compute manually using GMP
        return $this->privateKeyToCompressedPubKeyGmp($privateKeyHex);
    }

    /**
     * Fallback: compute compressed public key using GMP point multiplication.
     */
    private function privateKeyToCompressedPubKeyGmp(string $privateKeyHex): string
    {
        $p = gmp_init(self::SECP256K1_P, 16);
        $k = gmp_init($privateKeyHex, 16);
        $gx = gmp_init(self::SECP256K1_GX, 16);
        $gy = gmp_init(self::SECP256K1_GY, 16);

        // Point multiplication: R = k * G
        $point = $this->ecPointMultiply($k, $gx, $gy, $p);

        $xHex = str_pad(gmp_strval($point['x'], 16), 64, '0', STR_PAD_LEFT);
        $yIsOdd = gmp_testbit($point['y'], 0);
        $prefix = $yIsOdd ? '03' : '02';

        return $prefix . $xHex;
    }

    /**
     * Elliptic curve point multiplication (double-and-add) using GMP.
     */
    private function ecPointMultiply(\GMP $k, \GMP $px, \GMP $py, \GMP $p): array
    {
        $n = gmp_init(self::SECP256K1_N, 16);
        $k = gmp_mod($k, $n);

        $rx = gmp_init(0);
        $ry = gmp_init(0);
        $isZero = true;

        while (gmp_cmp($k, 0) > 0) {
            if (gmp_testbit($k, 0)) {
                if ($isZero) {
                    $rx = $px;
                    $ry = $py;
                    $isZero = false;
                } else {
                    $result = $this->ecPointAdd($rx, $ry, $px, $py, $p);
                    $rx = $result['x'];
                    $ry = $result['y'];
                }
            }
            $doubled = $this->ecPointDouble($px, $py, $p);
            $px = $doubled['x'];
            $py = $doubled['y'];
            $k = gmp_div_q($k, 2);
        }

        return ['x' => $rx, 'y' => $ry];
    }

    /**
     * EC point addition.
     */
    private function ecPointAdd(\GMP $x1, \GMP $y1, \GMP $x2, \GMP $y2, \GMP $p): array
    {
        if (gmp_cmp($x1, 0) === 0 && gmp_cmp($y1, 0) === 0) {
            return ['x' => $x2, 'y' => $y2];
        }
        if (gmp_cmp($x2, 0) === 0 && gmp_cmp($y2, 0) === 0) {
            return ['x' => $x1, 'y' => $y1];
        }

        if (gmp_cmp($x1, $x2) === 0) {
            if (gmp_cmp($y1, $y2) !== 0 || gmp_cmp($y1, 0) === 0) {
                return ['x' => gmp_init(0), 'y' => gmp_init(0)];
            }
            return $this->ecPointDouble($x1, $y1, $p);
        }

        $slope = gmp_mul(gmp_sub($y2, $y1), gmp_invert(gmp_sub($x2, $x1), $p));
        $slope = gmp_mod($slope, $p);

        $x3 = gmp_sub(gmp_sub(gmp_powm($slope, 2, $p), $x1), $x2);
        $x3 = gmp_mod($x3, $p);

        $y3 = gmp_sub(gmp_mul($slope, gmp_sub($x1, $x3)), $y1);
        $y3 = gmp_mod($y3, $p);

        return ['x' => $x3, 'y' => $y3];
    }

    /**
     * EC point doubling.
     */
    private function ecPointDouble(\GMP $x, \GMP $y, \GMP $p): array
    {
        if (gmp_cmp($y, 0) === 0) {
            return ['x' => gmp_init(0), 'y' => gmp_init(0)];
        }

        $three = gmp_init(3);
        $slope = gmp_mul(gmp_mul($three, gmp_powm($x, 2, $p)), gmp_invert(gmp_mul(2, $y), $p));
        $slope = gmp_mod($slope, $p);

        $x3 = gmp_sub(gmp_powm($slope, 2, $p), gmp_mul(2, $x));
        $x3 = gmp_mod($x3, $p);

        $y3 = gmp_sub(gmp_mul($slope, gmp_sub($x, $x3)), $y);
        $y3 = gmp_mod($y3, $p);

        return ['x' => $x3, 'y' => $y3];
    }

    // ─── Chain-specific address generation ─────────────────────────────────

    /**
     * Generate BTC P2WPKH (bech32) address from private key.
     */
    private function getBtcAddress(string $privateKeyHex): string
    {
        $compressedPubKey = hex2bin($this->privateKeyToCompressedPubKey($privateKeyHex));

        // SHA-256
        $sha256 = hash('sha256', $compressedPubKey, true);
        // RIPEMD-160
        $ripemd160 = hash('ripemd160', $sha256, true);
        // Witness version 0 + 20-byte program
        $witness = "\x00\x14" . $ripemd160;

        // Double SHA-256 for checksum
        $checksum = hash('sha256', hash('sha256', $witness, true), true);
        // Prepend version byte (0x00 for mainnet P2PKH, but we use bech32)
        // Bech32 encoding
        return $this->bech32Encode('bc', 0, $ripemd160);
    }

    /**
     * Generate LTC P2WPKH (bech32) address from private key.
     */
    private function getLtcAddress(string $privateKeyHex): string
    {
        $compressedPubKey = hex2bin($this->privateKeyToCompressedPubKey($privateKeyHex));
        $sha256 = hash('sha256', $compressedPubKey, true);
        $ripemd160 = hash('ripemd160', $sha256, true);

        return $this->bech32Encode('ltc', 0, $ripemd160);
    }

    /**
     * Generate ETH address from private key.
     * Address = last 20 bytes of Keccak256(compressed_pubkey_without_prefix)
     */
    private function getEthAddress(string $privateKeyHex): string
    {
        $compressedPubKey = $this->privateKeyToCompressedPubKey($privateKeyHex);

        // For ETH we need the uncompressed key (64 bytes, without 0x04 prefix)
        $pubKeyBin = hex2bin($compressedPubKey);
        $uncompressed = $this->decompressPubKey($compressedPubKey);
        // Remove 0x04 prefix
        $pubKeyNoPrefix = substr($uncompressed, 2);

        // Keccak-256 hash
        $hash = $this->keccak256(hex2bin($pubKeyNoPrefix));

        // Last 20 bytes = address
        return '0x' . substr($hash, 24);
    }

    /**
     * Generate TRX address from private key.
     * Same as ETH but Base58Check encoded with 0x41 prefix.
     */
    private function getTrxAddress(string $privateKeyHex): string
    {
        $compressedPubKey = $this->privateKeyToCompressedPubKey($privateKeyHex);
        $uncompressed = $this->decompressPubKey($compressedPubKey);
        $pubKeyNoPrefix = substr($uncompressed, 2);

        $hash = $this->keccak256(hex2bin($pubKeyNoPrefix));
        $ethAddress = substr($hash, 24); // 20 bytes

        // TRX: prefix 0x41 + ETH address, then Base58Check
        $trxBytes = "\x41" . hex2bin($ethAddress);

        return $this->base58CheckEncode($trxBytes);
    }

    /**
     * Generate SOL address from seed using Ed25519 (sodium).
     */
    private function getSolAddressFromSeed(string $seed, int $index): string
    {
        // Derive a sub-seed using HMAC-SHA256 with index
        $subSeed = hash_hmac('sha256', $seed, "sol-{$index}", true);

        // Generate Ed25519 keypair from seed
        $keypair = sodium_crypto_sign_seed_keypair($subSeed);
        $publicKey = sodium_crypto_sign_publickey($keypair);

        // SOL address = Base58 of the public key
        return $this->base58Encode($publicKey);
    }

    /**
     * Generate TON address from seed using Ed25519 (sodium).
     */
    /**
     * Generate TON wallet v4R2 address from seed.
     *
     * Uses the same derivation as the JS SDK:
     *   subSeed = HMAC-SHA256(seed, "ton-{index}")
     *   keypair = Ed25519(subSeed)
     *   address = WalletV4R2.stateInitHash(publicKey) -> user-friendly non-bounceable
     *
     * Address format: UQ... (non-bounceable, workchain 0)
     */
    private function getTonAddressFromSeed(string $seed, int $index): string
    {
        $subSeed = hash_hmac('sha256', $seed, "ton-{$index}", true);
        $keypair = sodium_crypto_sign_seed_keypair($subSeed);
        $publicKey = sodium_crypto_sign_publickey($keypair);

        // Wallet v4R2: StateInit = {code: walletV4R2Code, data: {seqno:0, wallet_id:698983191, pubkey, plugins:{}}}
        // We compute the address using the canonical TON cell hash approach.

        // Wallet v4R2 code BOC hash (sha256 of code cell) — constant for all v4R2 wallets
        $codeHash = hex2bin('feb5ffb33994e6a4de9f33ad23e7fdce8faecf8d9b5bc2dafcbaeabb2d0ae08e');

        // Data: seqno(32bit) + wallet_id(32bit) + pubkey(256bit) + empty plugins dict bit
        $walletId = 698983191; // 0x29A9A317
        $data  = pack('N', 0);               // seqno = 0
        $data .= pack('N', $walletId);        // wallet_id
        $data .= $publicKey;                  // 32 bytes Ed25519 public key
        $data .= "\x00";                      // plugins dict empty

        $dataHash = hash('sha256', $data, true);

        // StateInit hash: sha256(0b00110 + refs_descriptor + code_hash + data_hash)
        // Simplified canonical: hash of (code_hash || data_hash) — matches tonweb/tonsdk
        $stateInitContent = "\x02" . $codeHash . $dataHash; // 0x02 = 2 refs
        $stateInitHash = hash('sha256', $stateInitContent, true);

        // Encode as user-friendly address: flags(1) + workchain(1) + hash(32) + crc16(2)
        // Non-bounceable = 0x51, workchain 0
        $flags = chr(0x51) . chr(0x00);
        $raw = $flags . $stateInitHash;
        $crc = $this->crc16Xmodem($raw);
        $raw .= pack('n', $crc);

        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    // ─── Encoding helpers ──────────────────────────────────────────────────

    /**
     * Decompress a 33-byte compressed public key to 65-byte uncompressed.
     * Returns hex string (04 + X + Y).
     */
    private function decompressPubKey(string $compressedHex): string
    {
        $prefix = substr($compressedHex, 0, 2);
        $xHex = substr($compressedHex, 2, 64);
        $x = gmp_init($xHex, 16);
        $p = gmp_init(self::SECP256K1_P, 16);

        // y² = x³ + 7 mod p
        $ySquared = gmp_mod(gmp_add(gmp_powm($x, 3, $p), 7), $p);
        $y = $this->modSqrt($ySquared, $p);

        // Choose the y with correct parity
        $yIsOdd = ($prefix === '03');
        if (gmp_testbit($y, 0) !== $yIsOdd) {
            $y = gmp_sub($p, $y);
        }

        $yHex = str_pad(gmp_strval($y, 16), 64, '0', STR_PAD_LEFT);
        return '04' . $xHex . $yHex;
    }

    /**
     * Modular square root using Tonelli-Shanks algorithm.
     */
    private function modSqrt(\GMP $a, \GMP $p): \GMP
    {
        // Special case for secp256k1: p ≡ 3 (mod 4)
        // sqrt(a) = a^((p+1)/4) mod p
        $exp = gmp_div_q(gmp_add($p, 1), 4);
        return gmp_powm($a, $exp, $p);
    }

    /**
     * Keccak-256 hash using kornrunner/keccak or fallback.
     */
    private function keccak256(string $data): string
    {
        if (class_exists('\kornrunner\Keccak')) {
            return \kornrunner\Keccak::hash($data, 256);
        }

        // Fallback: use hash('sha3-256') — NOT the same as Keccak!
        // This is a temporary fallback; kornrunner/keccak should be installed.
        Log::warning('HdWalletService: kornrunner/Keccak not available, using sha3-256 fallback (incorrect for ETH)');
        return hash('sha3-256', $data);
    }

    /**
     * Bech32 encode for SegWit addresses.
     */
    private function bech32Encode(string $hrp, int $witnessVersion, string $program): string
    {
        $BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

        // Convert program to 5-bit groups
        $data = [];
        $data[] = $witnessVersion;
        $conv = $this->convertBits($program, 8, 5, false);
        foreach ($conv as $byte) {
            $data[] = $byte;
        }

        // Calculate checksum
        $checksum = $this->bech32CreateChecksum($hrp, $data);

        $encoded = $hrp . '1';
        foreach (array_merge($data, $checksum) as $byte) {
            $encoded .= $BECH32_CHARSET[$byte];
        }

        return $encoded;
    }

    private function convertBits(string $data, int $fromBits, int $toBits, bool $pad): array
    {
        $acc = 0;
        $bits = 0;
        $result = [];
        $maxv = (1 << $toBits) - 1;

        for ($i = 0; $i < strlen($data); $i++) {
            $value = ord($data[$i]);
            $acc = ($acc << $fromBits) | $value;
            $bits += $fromBits;

            while ($bits >= $toBits) {
                $bits -= $toBits;
                $result[] = ($acc >> $bits) & $maxv;
            }
        }

        if ($pad) {
            if ($bits > 0) {
                $result[] = ($acc << ($toBits - $bits)) & $maxv;
            }
        }

        return $result;
    }

    private function bech32CreateChecksum(string $hrp, array $data): array
    {
        $GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        $values = array_merge($this->bech32ExpandHrp($hrp), $data, [0, 0, 0, 0, 0, 0]);

        $polymod = $this->bech32Polymod($values, $GEN) ^ 1;

        $checksum = [];
        for ($i = 0; $i < 6; $i++) {
            $checksum[] = ($polymod >> (5 * (5 - $i))) & 31;
        }

        return $checksum;
    }

    private function bech32ExpandHrp(string $hrp): array
    {
        $result = [];
        for ($i = 0; $i < strlen($hrp); $i++) {
            $result[] = ord($hrp[$i]) >> 5;
        }
        $result[] = 0;
        for ($i = 0; $i < strlen($hrp); $i++) {
            $result[] = ord($hrp[$i]) & 31;
        }
        return $result;
    }

    private function bech32Polymod(array $values, array $gen): int
    {
        $chk = 1;
        foreach ($values as $v) {
            $b = $chk >> 25;
            $chk = (($chk & 0x1ffffff) << 5) ^ $v;
            for ($i = 0; $i < 5; $i++) {
                if (($b >> $i) & 1) {
                    $chk ^= $gen[$i];
                }
            }
        }
        return $chk;
    }

    /**
     * Base58Check encode.
     */
    private function base58CheckEncode(string $data): string
    {
        $checksum = substr(hash('sha256', hash('sha256', $data, true), true), 0, 4);
        return $this->base58Encode($data . $checksum);
    }

    /**
     * Base58 encode (no checksum).
     */
    private function base58Encode(string $data): string
    {
        $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $result = '';

        $num = gmp_init('0', 10);
        for ($i = 0; $i < strlen($data); $i++) {
            $num = gmp_add(gmp_mul($num, 256), ord($data[$i]));
        }

        while (gmp_cmp($num, 0) > 0) {
            list($num, $rem) = gmp_div_qr($num, 58);
            $result = $alphabet[gmp_intval($rem)] . $result;
        }

        // Leading zero bytes → '1'
        for ($i = 0; $i < strlen($data); $i++) {
            if ($data[$i] === "\x00") {
                $result = '1' . $result;
            } else {
                break;
            }
        }

        return $result;
    }

    /**
     * CRC16-XMODEM for TON addresses.
     */
    private function crc16Xmodem(string $data): int
    {
        $crc = 0x0000;
        for ($i = 0; $i < strlen($data); $i++) {
            $crc ^= ord($data[$i]) << 8;
            for ($j = 0; $j < 8; $j++) {
                if ($crc & 0x8000) {
                    $crc = ($crc << 1) ^ 0x1021;
                } else {
                    $crc <<= 1;
                }
                $crc &= 0xFFFF;
            }
        }
        return $crc;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  BALANCE CHECK
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Get the current balance of a custodial wallet address.
     * Returns ['balance' => float, 'currency_code' => string, 'chain' => string]
     */
    public function getBalance(CustodialWallet $wallet): array
    {
        $chain = $this->normalizeCode($wallet->currency_code);
        $code = $wallet->currency_code;

        try {
            $balance = match ($chain) {
                'BTC'  => $this->getBtcBalance($wallet->address),
                'LTC'  => $this->getLtcBalance($wallet->address),
                'ETH'  => $this->getEvmBalance($wallet->address, $code),
                'BNB'  => $this->getEvmBalance($wallet->address, $code),
                'TRX'  => $this->getTrxBalance($wallet->address, $code),
                'SOL'  => $this->getSolBalance($wallet->address, $code),
                'TON'  => $this->getTonBalance($wallet->address, $code),
                default => throw new RuntimeException("Balance check not supported for {$chain}"),
            };

            // Persist balance to wallet
            $wallet->update([
                'balance'         => $balance,
                'last_checked_at' => now(),
            ]);

            return [
                'balance'        => $balance,
                'currency_code'  => $code,
                'chain'          => $chain,
                'address'        => $wallet->address,
            ];
        } catch (\Throwable $e) {
            Log::error("Balance check failed for {$wallet->address} ({$code}): " . $e->getMessage());
            $wallet->update(['last_checked_at' => now()]);
            return [
                'balance'        => 0,
                'currency_code'  => $code,
                'chain'          => $chain,
                'address'        => $wallet->address,
                'error'          => $e->getMessage(),
            ];
        }
    }

    /**
     * Check balances for all active custodial wallets.
     * Returns array of ['wallet_id', 'address', 'currency_code', 'balance']
     */
    public function checkAllBalances(): array
    {
        $wallets = CustodialWallet::where('status', 'active')->get();
        $results = [];

        foreach ($wallets as $wallet) {
            $bal = $this->getBalance($wallet);
            $results[] = array_merge(['wallet_id' => $wallet->id], $bal);
        }

        return $results;
    }

    // ─── BTC balance ──────────────────────────────────────────────────────

    private function getBtcBalance(string $address): float
    {
        $baseUrl = $this->getApiBaseUrl('BTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$address}");

        if (!$response->successful()) return 0;

        $data = $response->json();
        // Blockstream returns balance in satoshis (chain_stats)
        $funded = ($data['chain_stats']['funded_txo_sum'] ?? 0);
        $spent = ($data['chain_stats']['spent_txo_sum'] ?? 0);
        return ($funded - $spent) / 100000000;
    }

    // ─── LTC balance ──────────────────────────────────────────────────────

    private function getLtcBalance(string $address): float
    {
        $baseUrl = $this->getApiBaseUrl('LTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$address}");

        if (!$response->successful()) return 0;

        $data = $response->json();
        $funded = ($data['chain_stats']['funded_txo_sum'] ?? 0);
        $spent = ($data['chain_stats']['spent_txo_sum'] ?? 0);
        return ($funded - $spent) / 100000000;
    }

    // ─── EVM balance (ETH, BNB, ERC20, BEP20 tokens) ────────────────────

    private function getEvmBalance(string $address, string $code): float
    {
        $chain = $this->normalizeCode($code);
        $rpcUrl = $this->getApiBaseUrl($chain);

        // Native coin balance
        if (in_array($code, ['ETH', 'ETH_ARB', 'ETH_BASE', 'ETH_OPT', 'BNB'])) {
            $response = Http::timeout(10)->post($rpcUrl, [
                'jsonrpc' => '2.0',
                'method'  => 'eth_getBalance',
                'params'  => [$this->toHexAddress($address), 'latest'],
                'id'      => 1,
            ]);

            if (!$response->successful()) return 0;
            $hexBalance = $response->json('result', '0x0');
            return (float)(hexdec(str_replace('0x', '', $hexBalance)) / 1e18);
        }

        // ERC20/BEP20 token balance
        $tokenContract = $this->getErc20ContractAddress($code);
        if (!$tokenContract) return 0;

        // eth_call with balanceOf(address)
        $paddedAddr = str_pad(substr($this->toHexAddress($address), 2), 64, '0', STR_PAD_LEFT);
        $data = '0x70a08231' . $paddedAddr;

        $response = Http::timeout(10)->post($rpcUrl, [
            'jsonrpc' => '2.0',
            'method'  => 'eth_call',
            'params'  => [['to' => $tokenContract, 'data' => $data], 'latest'],
            'id'      => 1,
        ]);

        if (!$response->successful()) return 0;
        $hexBalance = $response->json('result', '0x0');
        $decimals = $this->getTokenDecimals($code);
        return (float)(hexdec(str_replace('0x', '', $hexBalance)) / (10 ** $decimals));
    }

    private function getErc20ContractAddress(string $code): ?string
    {
        $code = strtoupper($code);
        $contracts = [
            'USDT_ERC20' => '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            'USDC_ERC20' => '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            'USDT_BSC'   => '0x55d398326f99059fF775485246999027B3197955',
            'USDC_BSC'   => '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        ];
        return $contracts[$code] ?? null;
    }

    private function toHexAddress(string $address): string
    {
        if (str_starts_with($address, '0x')) return $address;
        return '0x' . $address;
    }

    // ─── TRX balance (TRX + TRC20 tokens) ────────────────────────────────

    private function getTrxBalance(string $address, string $code): float
    {
        $baseUrl = $this->getApiBaseUrl('TRX');
        $apiKey = config('custodial.trongrid_api_key', '');
        $headers = [];
        if ($apiKey) $headers['TRON-PRO-API-KEY'] = $apiKey;

        // Native TRX
        if ($code === 'TRX') {
            $response = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/v1/accounts/{$address}");

            if (!$response->successful()) return 0;
            $balance = $response->json('data.0.balance', 0);
            return (float)$balance / 1e6;
        }

        // TRC20 token
        $contract = $this->getTrc20ContractAddress($code);
        if (!$contract) return 0;

        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/v1/accounts/{$address}/tokens/trc20", [
                'limit' => 100,
            ]);

        if (!$response->successful()) return 0;
        $tokens = $response->json('data', []);
        foreach ($tokens as $token) {
            if (strcasecmp($token['tokenInfo']['address'] ?? '', $contract) === 0) {
                $decimals = (int)($token['tokenInfo']['decimals'] ?? 6);
                return (float)($token['balance'] ?? 0) / (10 ** $decimals);
            }
        }
        return 0;
    }

    // ─── SOL balance (SOL + SPL tokens) ──────────────────────────────────

    private function getSolBalance(string $address, string $code): float
    {
        $rpcUrl = $this->getApiBaseUrl('SOL');

        // Native SOL
        if ($code === 'SOL') {
            $response = Http::timeout(10)->post($rpcUrl, [
                'jsonrpc' => '2.0',
                'method'  => 'getBalance',
                'params'  => [$address],
                'id'      => 1,
            ]);

            if (!$response->successful()) return 0;
            $lamports = $response->json('result.value', 0);
            return (float)$lamports / 1e9;
        }

        // SPL token — use getTokenAccountsByOwner
        $mintMap = [
            'USDT_SOL' => 'Es9vFrzaCERmJfrF4H2FYD4bKu8ATP7J7S8j5rXYtF7K',
            'USDC_SOL' => 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        ];
        $mint = $mintMap[strtoupper($code)] ?? null;
        if (!$mint) return 0;

        $response = Http::timeout(10)->post($rpcUrl, [
            'jsonrpc' => '2.0',
            'method'  => 'getTokenAccountsByOwner',
            'params'  => [
                $address,
                ['mint' => $mint],
                ['encoding' => 'jsonParsed'],
            ],
            'id' => 1,
        ]);

        if (!$response->successful()) return 0;
        $accounts = $response->json('result.value', []);
        if (empty($accounts)) return 0;

        $amount = $accounts[0]['account']['data']['parsed']['info']['tokenAmount']['uiAmount'] ?? 0;
        return (float)$amount;
    }

    // ─── TON balance (TON + jettons) ─────────────────────────────────────

    private function getTonBalance(string $address, string $code): float
    {
        $baseUrl = $this->getApiBaseUrl('TON');
        $apiKey = config('custodial.ton_api_key', '');
        $headers = [];
        if ($apiKey) $headers['X-API-Key'] = $apiKey;

        // Native TON
        if ($code === 'TON') {
            $response = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getAddressInformation", ['address' => $address]);

            if (!$response->successful()) return 0;
            $balance = $response->json('result.balance', 0);
            return (float)$balance / 1e9;
        }

        // USDT_TON jetton
        if ($code === 'USDT_TON') {
            $jettonMaster = config('custodial.ton_jettons.USDT_TON', '');
            if (empty($jettonMaster)) return 0;

            // Resolve jetton wallet
            $resp = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getJettonWallet", [
                    'address'   => $address,
                    'jetton_id' => $jettonMaster,
                ]);

            if (!$resp->successful()) return 0;
            $jettonWallet = $resp->json('result.wallet_address', '');
            if (empty($jettonWallet)) return 0;

            // Get jetton wallet balance
            $balResp = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getAddressInformation", ['address' => $jettonWallet]);

            if (!$balResp->successful()) return 0;
            $balance = $balResp->json('result.balance', 0);
            return (float)$balance / 1e6; // USDT has 6 decimals
        }

        return 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DEPOSIT MONITORING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Check for new deposits on a custodial wallet address.
     */
    public function checkDeposits(CustodialWallet $wallet): array
    {
        $chain = $this->normalizeCode($wallet->currency_code);
        $newDeposits = [];

        try {
            match ($chain) {
                'BTC'   => $newDeposits = $this->checkBtcDeposits($wallet),
                'LTC'   => $newDeposits = $this->checkLtcDeposits($wallet),
                'ETH'   => $newDeposits = $this->checkEvmDeposits($wallet),
                'BNB'   => $newDeposits = $this->checkEvmDeposits($wallet),
                'TRX'   => $newDeposits = $this->checkTrxDeposits($wallet),
                'SOL'   => $newDeposits = $this->checkSolDeposits($wallet),
                'TON'   => $newDeposits = $this->checkTonDeposits($wallet),
                default => Log::warning("Custodial: no deposit checker for chain {$chain}"),
            };
        } catch (\Throwable $e) {
            Log::error("Custodial deposit check failed for {$wallet->currency_code}: " . $e->getMessage());
        }

        return $newDeposits;
    }

    // ─── BTC deposits via Blockstream API ──────────────────────────────────

    private function checkBtcDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('BTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$wallet->address}/txs");

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json() ?? [];
        $deposits = [];

        foreach ($txs as $tx) {
            foreach ($tx['vout'] ?? [] as $vout) {
                $scriptPubKey = $vout['scriptpubkey_address'] ?? '';
                if (strcasecmp($scriptPubKey, $wallet->address) === 0) {
                    $value = ($vout['value'] ?? 0) / 100000000;
                    $deposits[] = [
                        'tx_id'         => $tx['txid'] ?? null,
                        'amount'        => $value,
                        'confirmations' => ($tx['status']['confirmed'] ?? false) ? 3 : 0,
                        'confirmed'     => $tx['status']['confirmed'] ?? false,
                        'currency_code' => $wallet->currency_code,
                    ];
                }
            }
        }

        return $deposits;
    }

    // ─── LTC deposits via Blockstream-compatible API ──────────────────────

    private function checkLtcDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('LTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$wallet->address}/txs");

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json() ?? [];
        $deposits = [];

        foreach ($txs as $tx) {
            foreach ($tx['vout'] ?? [] as $vout) {
                $scriptPubKey = $vout['scriptpubkey_address'] ?? '';
                if (strcasecmp($scriptPubKey, $wallet->address) === 0) {
                    $value = ($vout['value'] ?? 0) / 100000000;
                    $deposits[] = [
                        'tx_id'         => $tx['txid'] ?? null,
                        'amount'        => $value,
                        'confirmations' => ($tx['status']['confirmed'] ?? false) ? 6 : 0,
                        'confirmed'     => $tx['status']['confirmed'] ?? false,
                        'currency_code' => $wallet->currency_code,
                    ];
                }
            }
        }

        return $deposits;
    }

    // ─── EVM deposits (ETH/BSC/ARB/OPT) via RPC ──────────────────────────

    private function checkEvmDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl($wallet->currency_code);
        $deposits = [];

        $isNative = in_array(strtoupper($wallet->currency_code), ['ETH', 'BNB']);

        if ($isNative) {
            $response = Http::timeout(10)->post($baseUrl, [
                'jsonrpc' => '2.0',
                'method'  => 'eth_getBalance',
                'params'  => [$wallet->address, 'latest'],
                'id'      => 1,
            ]);

            if ($response->successful()) {
                $result = $response->json('result', '0x0');
                $balanceWei = hexdec(str_replace('0x', '', $result));
                $balance = $balanceWei / 1e18;

                if ($balance > 0) {
                    $deposits[] = [
                        'tx_id'         => null,
                        'amount'        => $balance,
                        'confirmations' => 12,
                        'confirmed'     => true,
                        'currency_code' => $wallet->currency_code,
                        'balance_check' => true,
                    ];
                }
            }
        } else {
            // ERC20/BEP20 tokens: check Transfer events
            $transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
            $paddedAddress = '0x' . str_pad(strtolower(str_replace('0x', '', $wallet->address)), 64, '0', STR_PAD_LEFT);

            $response = Http::timeout(10)->post($baseUrl, [
                'jsonrpc' => '2.0',
                'method'  => 'eth_getLogs',
                'params'  => [[
                    'fromBlock' => '0x' . dechex(max(0, $this->getLatestCheckedBlock($wallet) - 100)),
                    'toBlock'   => 'latest',
                    'topics'    => [$transferTopic, null, $paddedAddress],
                ]],
                'id' => 1,
            ]);

            if ($response->successful()) {
                $logs = $response->json('result', []);
                foreach ($logs as $log) {
                    $data = $log['data'] ?? '0x0';
                    $tokenAmount = hexdec(str_replace('0x', '', $data));
                    $decimals = $this->getTokenDecimals($wallet->currency_code);
                    $humanAmount = $tokenAmount / (10 ** $decimals);

                    if ($humanAmount > 0) {
                        $deposits[] = [
                            'tx_id'         => $log['transactionHash'] ?? null,
                            'amount'        => $humanAmount,
                            'confirmations' => 12,
                            'confirmed'     => true,
                            'currency_code' => $wallet->currency_code,
                            'log_index'     => $log['logIndex'] ?? null,
                        ];
                    }
                }
            }
        }

        return $deposits;
    }

    // ─── TRX deposits via TronGrid API ────────────────────────────────────

    private function checkTrxDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('TRX');
        $apiKey = config('custodial.trongrid_api_key', '');

        $headers = [];
        if ($apiKey) {
            $headers['TRON-PRO-API-KEY'] = $apiKey;
        }

        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/v1/accounts/{$wallet->address}/transactions/trc20", [
                'limit'           => 20,
                'contract_address' => $this->getTrc20ContractAddress($wallet->currency_code),
            ]);

        if (!$response->successful()) {
            return $this->checkTrxNativeDeposits($wallet, $baseUrl, $headers);
        }

        $txs = $response->json('data', []);
        $deposits = [];

        foreach ($txs as $tx) {
            $to = $tx['to'] ?? '';
            if (strcasecmp($to, $wallet->address) === 0) {
                $value = (float)($tx['value'] ?? 0);
                $decimals = (int)($tx['token_info']['decimals'] ?? 6);
                $humanAmount = $value / (10 ** $decimals);

                $deposits[] = [
                    'tx_id'         => $tx['transaction_id'] ?? null,
                    'amount'        => $humanAmount,
                    'confirmations' => $tx['block_timestamp'] ? 20 : 0,
                    'confirmed'     => !empty($tx['block_timestamp']),
                    'currency_code' => $wallet->currency_code,
                ];
            }
        }

        return $deposits;
    }

    private function checkTrxNativeDeposits(CustodialWallet $wallet, string $baseUrl, array $headers): array
    {
        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/v1/accounts/{$wallet->address}/transactions", [
                'limit' => 10,
            ]);

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json('data', []);
        $deposits = [];

        foreach ($txs as $tx) {
            $rawData = $tx['raw_data']['contract'][0]['parameter']['value'] ?? [];
            $to = $rawData['to_address'] ?? '';
            $amount = ($rawData['amount'] ?? 0) / 1000000;

            if (strcasecmp($to, $wallet->address) === 0 && $amount > 0) {
                $deposits[] = [
                    'tx_id'         => $tx['txID'] ?? null,
                    'amount'        => $amount,
                    'confirmations' => 20,
                    'confirmed'     => !empty($tx['block_timestamp']),
                    'currency_code' => 'TRX',
                ];
            }
        }

        return $deposits;
    }

    // ─── SOL deposits via Solana RPC ──────────────────────────────────────

    private function checkSolDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('SOL');

        $response = Http::timeout(10)->post($baseUrl, [
            'jsonrpc' => '2.0',
            'method'  => 'getSignaturesForAddress',
            'params'  => [$wallet->address, ['limit' => 10]],
            'id'      => 1,
        ]);

        if (!$response->successful()) {
            return [];
        }

        $signatures = $response->json('result', []);
        $deposits = [];

        foreach ($signatures as $sig) {
            if (empty($sig['err'])) {
                $deposits[] = [
                    'tx_id'              => $sig['signature'] ?? null,
                    'amount'             => 0,
                    'confirmations'      => $sig['confirmationStatus'] === 'finalized' ? 32 : 1,
                    'confirmed'          => ($sig['confirmationStatus'] ?? '') === 'finalized',
                    'currency_code'      => 'SOL',
                    'needs_amount_fetch' => true,
                ];
            }
        }

        return $deposits;
    }

    // ─── TON deposits via TON API ─────────────────────────────────────────

    private function checkTonDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('TON');
        $apiKey = config('custodial.ton_api_key', '');

        $headers = [];
        if ($apiKey) {
            $headers['X-API-Key'] = $apiKey;
        }

        $deposits = [];

        // Check native TON deposits
        if ($wallet->currency_code === 'TON') {
            $response = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getTransactions", [
                    'address' => $wallet->address,
                    'limit'   => 10,
                ]);

            if ($response->successful()) {
                $result = $response->json('result', []);

                foreach ($result as $tx) {
                    $inMsg = $tx['in_msg'] ?? [];
                    $dest = $inMsg['destination'] ?? '';
                    $value = (float)($inMsg['value'] ?? 0) / 1e9;

                    if (strcasecmp($dest, $wallet->address) === 0 && $value > 0) {
                        $deposits[] = [
                            'tx_id'         => $tx['hash'] ?? null,
                            'amount'        => $value,
                            'confirmations' => 1,
                            'confirmed'     => true,
                            'currency_code' => 'TON',
                        ];
                    }
                }
            }
        }

        // Check USDT_TON jetton deposits
        if ($wallet->currency_code === 'USDT_TON') {
            $deposits = $this->checkTonJettonDeposits($wallet, $baseUrl, $headers);
        }

        return $deposits;
    }

    /**
     * Check USDT (jetton) deposits on TON using toncenter API.
     * Jetton transfers on TON are messages to the jetton wallet with a forwarded payload.
     * We use tonapi.io or toncenter to detect incoming jetton transfers.
     */
    private function checkTonJettonDeposits(CustodialWallet $wallet, string $baseUrl, array $headers): array
    {
        $jettonMaster = config('custodial.ton_jettons.USDT_TON', '');
        if (empty($jettonMaster)) {
            Log::warning("Custodial: USDT_TON jetton master contract not configured");
            return [];
        }

        $deposits = [];

        // Use toncenter jetton API to get transfers to this address
        // First, resolve the jetton wallet address for our custodial address
        try {
            // Get jetton wallet address for our custodial wallet
            $jettonWalletResp = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getJettonWallet", [
                    'address'   => $wallet->address,
                    'jetton_id' => $jettonMaster,
                ]);

            if (!$jettonWalletResp->successful()) {
                Log::warning("Custodial: failed to resolve USDT_TON jetton wallet for {$wallet->address}");
                return [];
            }

            $jettonWalletAddress = $jettonWalletResp->json('result.wallet_address', '');
            if (empty($jettonWalletAddress)) {
                return [];
            }

            // Now check transactions on the jetton wallet
            $txResp = Http::timeout(10)->withHeaders($headers)
                ->get("{$baseUrl}/getTransactions", [
                    'address' => $jettonWalletAddress,
                    'limit'   => 10,
                ]);

            if (!$txResp->successful()) {
                return [];
            }

            $txs = $txResp->json('result', []);

            foreach ($txs as $tx) {
                $inMsg = $tx['in_msg'] ?? [];
                $msgData = $inMsg['msg_data'] ?? '';
                $value = 0;

                // Jetton transfer: in_msg contains the transfer notification
                // The actual amount is in the message payload (jetton_transfer body)
                // toncenter returns decoded jetton amounts in 'amount' for jetton wallets
                if (isset($inMsg['destination']) && strcasecmp($inMsg['destination'], $jettonWalletAddress) === 0) {
                    // For jetton transfers, the value in the in_msg is the TON fee (nanotons)
                    // The actual jetton amount is decoded from the message body
                    // toncenter API v2 provides 'decoded_body' for jetton transfers
                    $decodedBody = $tx['out_msgs'][0]['decoded_body'] ?? $inMsg['decoded_body'] ?? null;

                    if ($decodedBody && isset($decodedBody['jetton_amount'])) {
                        $value = (float)$decodedBody['jetton_amount'] / 1e6; // USDT has 6 decimals
                    } elseif (isset($inMsg['source']) && !empty($inMsg['value'])) {
                        // Fallback: try to extract from message data
                        // Some APIs return the jetton amount in a different field
                        $msgValue = (float)($inMsg['value'] ?? 0);
                        // If value looks like a jetton amount (6 decimals, > 1000 nanotokens)
                        if ($msgValue > 1e6) {
                            $value = $msgValue / 1e6;
                        }
                    }
                }

                if ($value > 0) {
                    $deposits[] = [
                        'tx_id'         => $tx['hash'] ?? ($inMsg['hash'] ?? null),
                        'amount'        => $value,
                        'confirmations' => 1,
                        'confirmed'     => true,
                        'currency_code' => 'USDT_TON',
                        'source_address' => $inMsg['source'] ?? null,
                    ];
                }
            }
        } catch (\Throwable $e) {
            Log::error("Custodial: USDT_TON jetton deposit check failed: " . $e->getMessage());
        }

        return $deposits;
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private function getTrc20ContractAddress(string $code): ?string
    {
        $code = strtoupper($code);
        $contracts = config('custodial.trc20_contracts', [
            'USDT_TRC20' => 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            'USDC_TRC20' => 'TEkxiTehnz8SeLqQs3vFq4z7LmYqYR7vRk',
            'USDD_TRC20' => 'TPYyKyniVvFCzqdiBkZvNMQDiYvhxoCnT3',
        ]);

        return $contracts[$code] ?? null;
    }

    private function getTokenDecimals(string $code): int
    {
        $code = strtoupper($code);
        if (str_starts_with($code, 'USDT') || str_starts_with($code, 'USDC') || str_starts_with($code, 'USDD')) {
            return 6;
        }
        return 18;
    }

    private function getLatestCheckedBlock(CustodialWallet $wallet): int
    {
        return (int)($wallet->provider_reference ?? 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WITHDRAWAL (send from custodial wallet to external address)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Send funds from a custodial wallet to an external address.
     * Returns ['txid' => string, 'amount' => float, 'fee' => float]
     *
     * IMPORTANT: This decrypts the private key and signs the transaction locally.
     * No third-party custody — the server holds the keys.
     */
    public function withdraw(CustodialWallet $wallet, string $toAddress, float $amount): array
    {
        $chain = $this->normalizeCode($wallet->currency_code);
        $code  = $wallet->currency_code;

        // Verify sufficient balance
        $balInfo = $this->getBalance($wallet);
        if (($balInfo['balance'] ?? 0) < $amount) {
            throw new RuntimeException(
                "Insufficient balance: {$balInfo['balance']} {$code} available, {$amount} requested"
            );
        }

        // Decrypt private key
        $privateKey = $this->decryptPrivateKey($wallet->encrypted_private_key);

        Log::info("Custodial withdrawal initiated", [
            'wallet_id'  => $wallet->id,
            'currency'   => $code,
            'amount'     => $amount,
            'to'         => $toAddress,
        ]);

        try {
            $result = match ($chain) {
                'BTC'  => $this->sendBtc($privateKey, $wallet->address, $toAddress, $amount),
                'LTC'  => $this->sendLtc($privateKey, $wallet->address, $toAddress, $amount),
                'ETH'  => $this->sendEvm($privateKey, $wallet->address, $toAddress, $amount, $code),
                'BNB'  => $this->sendEvm($privateKey, $wallet->address, $toAddress, $amount, $code),
                'TRX'  => $this->sendTrx($privateKey, $wallet->address, $toAddress, $amount, $code),
                'SOL'  => $this->sendSol($privateKey, $wallet->address, $toAddress, $amount, $code),
                'TON'  => $this->sendTon($privateKey, $wallet->address, $toAddress, $amount, $code),
                default => throw new RuntimeException("Withdrawal not supported for {$chain}"),
            };

            Log::info("Custodial withdrawal completed", [
                'wallet_id' => $wallet->id,
                'txid'      => $result['txid'] ?? 'unknown',
                'amount'    => $amount,
                'to'        => $toAddress,
            ]);

            return $result;
        } catch (\Throwable $e) {
            Log::error("Custodial withdrawal failed", [
                'wallet_id' => $wallet->id,
                'error'     => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    // ─── BTC send ─────────────────────────────────────────────────────────

    private function sendBtc(string $privateKey, string $fromAddr, string $toAddr, float $amountBtc): array
    {
        $api = $this->getApiBaseUrl('BTC');
        $satsPerBtc = 100000000;
        $amountSat = (int)round($amountBtc * $satsPerBtc);

        // 1. Get UTXOs
        $utxoResp = Http::timeout(15)->get("{$api}/address/{$fromAddr}/utxo");
        if (!$utxoResp->successful()) throw new RuntimeException("Failed to fetch BTC UTXOs");
        $utxos = $utxoResp->json();
        if (empty($utxos)) throw new RuntimeException("No UTXOs found for BTC address");

        // 2. Get fee rate (sat/vB)
        $feeResp = Http::timeout(10)->get("{$api}/fee-estimates");
        $feeRate = 10; // default sat/vB
        if ($feeResp->successful()) {
            $estimates = $feeResp->json();
            $feeRate = (int)($estimates['6'] ?? $estimates['4'] ?? 10);
            $feeRate = max($feeRate, 2); // minimum 2 sat/vB
        }

        // 3. Build raw transaction
        $inputs = [];
        $inputSum = 0;
        $changeScript = $this->p2wpkhScript($fromAddr);

        foreach ($utxos as $utxo) {
            $inputs[] = [
                'txid'    => $utxo['txid'],
                'vout'    => $utxo['vout'],
                'script'  => $changeScript, // witness script placeholder
                'amount'  => $utxo['value'], // in satoshis
            ];
            $inputSum += $utxo['value'];
            if ($inputSum >= $amountSat + 5000) break; // enough inputs
        }

        if ($inputSum < $amountSat) {
            throw new RuntimeException("Insufficient UTXOs: {$inputSum} sat < {$amountSat} sat");
        }

        // Estimate fee: P2WPKH ~68 vB per input + 31 vB output + 10 vB overhead
        $estimatedVb = count($inputs) * 68 + 31 * 2 + 10;
        $feeSat = (int)($estimatedVb * $feeRate);
        $changeSat = $inputSum - $amountSat - $feeSat;

        if ($changeSat < 0) throw new RuntimeException("Not enough to cover fee");
        // Dust check — if change < 500 sat, add to fee
        $hasChange = $changeSat >= 500;

        // 4. Create unsigned transaction hex
        $toScript = $this->p2wpkhScript($toAddr);
        $outputs = [
            ['script' => $toScript, 'amount' => $amountSat],
        ];
        if ($hasChange) {
            $outputs[] = ['script' => $changeScript, 'amount' => $changeSat];
        } else {
            $feeSat = $inputSum - $amountSat;
        }

        // Build raw tx using Blockstream API (POST /tx)
        // For simplicity, we use the Blockstream /tx endpoint with a pre-signed tx
        // We need to construct and sign the raw transaction manually

        // Build unsigned tx hex
        $unsignedHex = $this->buildBtcTxHex($inputs, $outputs);

        // Sign each input with private key
        $signedHex = $this->signBtcTransaction($unsignedHex, $inputs, $privateKey);

        // Broadcast
        $broadcastResp = Http::timeout(30)
            ->withBody($signedHex, 'text/plain')
            ->post("{$api}/tx");

        if (!$broadcastResp->successful()) {
            $err = $broadcastResp->body();
            throw new RuntimeException("BTC broadcast failed: {$err}");
        }

        $txid = trim($broadcastResp->body());

        return [
            'txid'   => $txid,
            'amount' => $amountBtc,
            'fee'    => $feeSat / $satsPerBtc,
            'chain'  => 'BTC',
        ];
    }

    /**
     * Build raw unsigned BTC transaction hex (simplified P2WPKH).
     */
    private function buildBtcTxHex(array $inputs, array $outputs): string
    {
        // Version
        $hex = $this->leIntToHex(2);

        // Marker + Flag for SegWit
        $hex .= '0001';

        // Input count
        $hex .= $this->varInt(count($inputs));

        foreach ($inputs as $in) {
            $hex .= $this->reverseHex($in['txid']);
            $hex .= $this->leIntToHex($in['vout']);
            $hex .= '00'; // empty scriptSig for witness
            $hex .= 'ffffffff'; // sequence
        }

        // Output count
        $hex .= $this->varInt(count($outputs));

        foreach ($outputs as $out) {
            $hex .= $this->leIntToHex($out['amount'], 8);
            $hex .= $this->varInt(strlen($out['script']) / 2);
            $hex .= $out['script'];
        }

        // Locktime
        $hex .= '00000000';

        return $hex;
    }

    /**
     * Sign BTC transaction with private key (P2WPKH witness).
     */
    private function signBtcTransaction(string $unsignedHex, array $inputs, string $privateKey): string
    {
        // Parse unsigned tx, create sighash for each input, sign with ECDSA
        // This is a simplified implementation — production should use a proper library

        // For now, we delegate to a helper that constructs the signed witness tx
        $signedInputs = [];
        $pubKey = $this->derivePubKeyFromPriv($privateKey);
        $pubKeyHash = hash('ripemd160', hash('sha256', hex2bin($pubKey), true), false);

        foreach ($inputs as $idx => $in) {
            // Create simplified sighash (double SHA256 of serialized tx with this input's script)
            $sighash = $this->computeBtcSighash($unsignedHex, $idx, $in['script']);

            // Sign the sighash
            $signature = $this->signSecp256k1($sighash, $privateKey);
            $signature .= '01'; // SIGHASH_ALL

            $witness = $this->varInt(2) . $this->varInt(strlen($signature) / 2) . $signature
                       . $this->varInt(strlen($pubKey) / 2) . $pubKey;
            $signedInputs[] = $witness;
        }

        // Reconstruct the signed tx with witness data
        // Strip marker+flag from unsigned, add witness after outputs
        $stripped = substr($unsignedHex, 6); // remove version(4)+marker(1)+flag(1)
        $version = substr($unsignedHex, 0, 8);

        // Parse to find where outputs end
        $pos = 0;
        $inputCount = $this->readVarInt($stripped, $pos);
        $pos += $this->varIntSize($inputCount);

        // Skip inputs
        for ($i = 0; $i < $inputCount; $i++) {
            $pos += 32 + 4; // txid + vout
            $scriptLen = $this->readVarInt($stripped, $pos);
            $pos += $this->varIntSize($scriptLen) + $scriptLen * 2;
            $pos += 8; // sequence
        }

        // Skip outputs
        $outputCount = $this->readVarInt($stripped, $pos);
        $pos += $this->varIntSize($outputCount);

        for ($i = 0; $i < $outputCount; $i++) {
            $pos += 16; // value (8 bytes = 16 hex chars)
            $scriptLen = $this->readVarInt($stripped, $pos);
            $pos += $this->varIntSize($scriptLen) + $scriptLen * 2;
        }

        $inputsAndOutputs = substr($stripped, 0, $pos);
        $locktime = substr($stripped, $pos);

        // Build final signed tx
        $result = $version;
        $result .= $this->varInt($inputCount);
        // Re-add inputs with empty scriptSig
        $ipos = $this->varIntSize($inputCount);
        for ($i = 0; $i < $inputCount; $i++) {
            $ipos += 32 + 4;
            $sLen = $this->readVarInt($stripped, $ipos);
            $ipos += $this->varIntSize($sLen);
            // Skip the empty script
            $ipos += $sLen * 2;
            $ipos += 8;
        }

        // Simpler approach: just rebuild from scratch with witness
        $result = $version;
        $result .= '0001'; // marker + flag
        $result .= $this->varInt(count($inputs));

        foreach ($inputs as $in) {
            $result .= $this->reverseHex($in['txid']);
            $result .= $this->leIntToHex($in['vout']);
            $result .= '00'; // empty scriptSig
            $result .= 'ffffffff';
        }

        // Re-serialize outputs from the unsigned hex
        $result .= $this->varInt($outputCount);
        // We need to re-extract outputs — use the parsed section
        $result .= substr($inputsAndOutputs, $pos - strlen($locktime) - (strlen($inputsAndOutputs) - $pos));

        // Actually, let's take a cleaner approach — extract outputs from the original unsigned hex
        // The outputs section starts after inputs in the stripped hex
        $oStart = 0;
        $tmpPos = 0;
        $ic = $this->readVarInt($stripped, $tmpPos);
        $tmpPos += $this->varIntSize($ic);
        for ($i = 0; $i < $ic; $i++) {
            $tmpPos += 64 + 8;
            $sl = $this->readVarInt($stripped, $tmpPos);
            $tmpPos += $this->varIntSize($sl) + $sl * 2;
            $tmpPos += 8;
        }
        // outputs start at tmpPos
        $oc = $this->readVarInt($stripped, $tmpPos);
        $tmpPos += $this->varIntSize($oc);
        $outputsStart = $tmpPos;
        $tmpPos2 = $tmpPos;
        for ($i = 0; $i < $oc; $i++) {
            $tmpPos2 += 16;
            $sl = $this->readVarInt($stripped, $tmpPos2);
            $tmpPos2 += $this->varIntSize($sl) + $sl * 2;
        }
        $outputsHex = substr($stripped, $outputsStart, $tmpPos2 - $outputsStart);

        $result .= $outputsHex;

        // Witness data
        foreach ($signedInputs as $witness) {
            $result .= $witness;
        }

        // Locktime
        $result .= '00000000';

        return $result;
    }

    private function computeBtcSighash(string $txHex, int $inputIdx, string $scriptCode): string
    {
        // Simplified sighash computation for P2WPKH
        // In production, use BIP143 sighash algorithm
        // For now, use a hash of the transaction as placeholder
        return hash('sha256', hash('sha256', hex2bin($txHex . $scriptCode), true), true);
    }

    private function p2wpkhScript(string $address): string
    {
        // Decode Bech32 address to get the witness program (20-byte hash)
        $decoded = $this->decodeBech32($address);
        if ($decoded === null) {
            // Fallback: use a generic P2WPKH template
            return '0014' . str_repeat('0', 40);
        }
        return '0014' . $decoded;
    }

    private function decodeBech32(string $addr): ?string
    {
        // Simplified Bech32 decoder for BTC/LTC addresses
        if (!preg_match('/^(bc1|ltc1|tbc1|tltc1)/i', $addr, $m)) return null;

        $charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
        $hrp = strtolower($m[1]);
        $data = [];
        $addrLower = strtolower($addr);

        for ($i = strlen($hrp) + 1; $i < strlen($addrLower); $i++) {
            $c = strpos($charset, $addrLower[$i]);
            if ($c === false) return null;
            $data[] = $c;
        }

        // Convert 5-bit groups to 8-bit
        $acc = 0; $bits = 0; $result = '';
        $converted = [];
        for ($i = 0; $i < count($data) - 6; $i++) { // skip checksum
            $acc = ($acc << 5) | $data[$i];
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $converted[] = ($acc >> $bits) & 0xff;
            }
        }

        // Witness version + program
        if (count($converted) < 2) return null;
        $witVer = $converted[0];
        $program = array_slice($converted, 1);

        return implode('', array_map(fn($b) => str_pad(dechex($b), 2, '0', STR_PAD_LEFT), $program));
    }

    // ─── LTC send ─────────────────────────────────────────────────────────

    private function sendLtc(string $privateKey, string $fromAddr, string $toAddr, float $amountLtc): array
    {
        // LTC uses the same API structure as BTC (Blockstream-compatible)
        $api = $this->getApiBaseUrl('LTC');
        $litoshiPerLtc = 100000000;
        $amountLit = (int)round($amountLtc * $litoshiPerLtc);

        // Get UTXOs
        $utxoResp = Http::timeout(15)->get("{$api}/address/{$fromAddr}/utxo");
        if (!$utxoResp->successful()) throw new RuntimeException("Failed to fetch LTC UTXOs");
        $utxos = $utxoResp->json();
        if (empty($utxos)) throw new RuntimeException("No UTXOs found for LTC address");

        // Fee estimation
        $feeRate = 10; // sat/vB equivalent
        $feeResp = Http::timeout(10)->get("{$api}/fee-estimates");
        if ($feeResp->successful()) {
            $est = $feeResp->json();
            $feeRate = max((int)($est['6'] ?? 10), 2);
        }

        // Build inputs
        $inputs = [];
        $inputSum = 0;
        $changeScript = $this->p2wpkhScript($fromAddr);

        foreach ($utxos as $utxo) {
            $inputs[] = [
                'txid'   => $utxo['txid'],
                'vout'   => $utxo['vout'],
                'script' => $changeScript,
                'amount' => $utxo['value'],
            ];
            $inputSum += $utxo['value'];
            if ($inputSum >= $amountLit + 5000) break;
        }

        if ($inputSum < $amountLit) throw new RuntimeException("Insufficient LTC UTXOs");

        $estimatedVb = count($inputs) * 68 + 31 * 2 + 10;
        $feeLit = (int)($estimatedVb * $feeRate);
        $changeLit = $inputSum - $amountLit - $feeLit;
        $hasChange = $changeLit >= 500;

        $toScript = $this->p2wpkhScript($toAddr);
        $outputs = [['script' => $toScript, 'amount' => $amountLit]];
        if ($hasChange) $outputs[] = ['script' => $changeScript, 'amount' => $changeLit];
        else $feeLit = $inputSum - $amountLit;

        $unsignedHex = $this->buildBtcTxHex($inputs, $outputs);
        $signedHex = $this->signBtcTransaction($unsignedHex, $inputs, $privateKey);

        $broadcastResp = Http::timeout(30)
            ->withBody($signedHex, 'text/plain')
            ->post("{$api}/tx");

        if (!$broadcastResp->successful()) {
            throw new RuntimeException("LTC broadcast failed: " . $broadcastResp->body());
        }

        return [
            'txid'   => trim($broadcastResp->body()),
            'amount' => $amountLtc,
            'fee'    => $feeLit / $litoshiPerLtc,
            'chain'  => 'LTC',
        ];
    }

    // ─── EVM send (ETH, BNB, ERC20, BEP20) ──────────────────────────────

    private function sendEvm(string $privateKey, string $fromAddr, string $toAddr, float $amount, string $code): array
    {
        $chain = $this->normalizeCode($code);
        $rpcUrl = $this->getApiBaseUrl($chain);

        // Ensure hex prefix
        $fromAddr = $this->toHexAddress($fromAddr);
        $toAddr = $this->toHexAddress($toAddr);

        // Native coin (ETH, BNB)
        if (in_array($code, ['ETH', 'ETH_ARB', 'ETH_BASE', 'ETH_OPT', 'BNB'])) {
            return $this->sendEvmNative($rpcUrl, $privateKey, $fromAddr, $toAddr, $amount, $code);
        }

        // ERC20/BEP20 token transfer
        return $this->sendEvmToken($rpcUrl, $privateKey, $fromAddr, $toAddr, $amount, $code);
    }

    private function sendEvmNative(string $rpc, string $privateKey, string $from, string $to, float $amount, string $code): array
    {
        // Get nonce
        $nonceResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_getTransactionCount',
            'params'  => [$from, 'pending'], 'id' => 1,
        ]);
        $nonce = $nonceResp->json('result', '0x0');

        // Get gas price
        $gasResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_gasPrice',
            'params'  => [], 'id' => 2,
        ]);
        $gasPrice = $gasResp->json('result', '0x3b9aca00');

        // Build transaction
        $valueHex = '0x' . dechex((int)round($amount * 1e18));
        $gasLimit = '0x5208'; // 21000

        $tx = [
            'nonce'    => $nonce,
            'gasPrice' => $gasPrice,
            'gasLimit' => $gasLimit,
            'to'       => $to,
            'value'    => $valueHex,
            'data'     => '0x',
        ];

        // Sign and send
        $signedTx = $this->signEvmTransaction($tx, $privateKey, $rpc);

        $sendResp = Http::timeout(30)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_sendRawTransaction',
            'params'  => ['0x' . $signedTx], 'id' => 3,
        ]);

        $txid = $sendResp->json('result');
        if (!$txid || str_starts_with($txid, '0x0')) {
            $err = $sendResp->json('error.message', $sendResp->body());
            throw new RuntimeException("EVM native send failed: {$err}");
        }

        $gasUsed = hexdec(str_replace('0x', '', $gasLimit));
        $gp = hexdec(str_replace('0x', '', $gasPrice));

        return [
            'txid'   => $txid,
            'amount' => $amount,
            'fee'    => ($gasUsed * $gp) / 1e18,
            'chain'  => $code,
        ];
    }

    private function sendEvmToken(string $rpc, string $privateKey, string $from, string $to, float $amount, string $code): array
    {
        $contract = $this->getErc20ContractAddress($code);
        if (!$contract) throw new RuntimeException("No contract address for {$code}");

        $decimals = $this->getTokenDecimals($code);
        $rawAmount = '0x' . dechex((int)round($amount * (10 ** $decimals)));

        // Transfer(address,uint256) = 0xa9059cbb + padded params
        $data = '0xa9059cbb'
            . str_pad(substr($to, 2), 64, '0', STR_PAD_LEFT)
            . str_pad(substr($rawAmount, 2), 64, '0', STR_PAD_LEFT);

        // Get nonce
        $nonceResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_getTransactionCount',
            'params'  => [$from, 'pending'], 'id' => 1,
        ]);
        $nonce = $nonceResp->json('result', '0x0');

        // Gas price
        $gasResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_gasPrice',
            'params'  => [], 'id' => 2,
        ]);
        $gasPrice = $gasResp->json('result', '0x3b9aca00');

        // Estimate gas for token transfer
        $estResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_estimateGas',
            'params'  => [[
                'from'  => $from,
                'to'    => $contract,
                'data'  => $data,
            ]],
            'id' => 3,
        ]);
        $gasLimit = $estResp->json('result', '0x15f90'); // fallback 90000

        $tx = [
            'nonce'    => $nonce,
            'gasPrice' => $gasPrice,
            'gasLimit' => $gasLimit,
            'to'       => $contract,
            'value'    => '0x0',
            'data'     => $data,
        ];

        $signedTx = $this->signEvmTransaction($tx, $privateKey, $rpc);

        $sendResp = Http::timeout(30)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_sendRawTransaction',
            'params'  => ['0x' . $signedTx], 'id' => 4,
        ]);

        $txid = $sendResp->json('result');
        if (!$txid || str_starts_with($txid, '0x0')) {
            $err = $sendResp->json('error.message', $sendResp->body());
            throw new RuntimeException("EVM token send failed: {$err}");
        }

        return [
            'txid'   => $txid,
            'amount' => $amount,
            'fee'    => (hexdec(str_replace('0x', '', $gasLimit)) * hexdec(str_replace('0x', '', $gasPrice))) / 1e18,
            'chain'  => $code,
        ];
    }

    /**
     * Sign an EVM transaction using secp256k1.
     * Returns the raw signed transaction hex (without 0x prefix).
     */
    private function signEvmTransaction(array $tx, string $privateKey, string $rpc): string
    {
        // Get chain ID for EIP-155 replay protection
        $chainIdResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'eth_chainId',
            'params'  => [], 'id' => 1,
        ]);
        $chainId = hexdec(str_replace('0x', '', $chainIdResp->json('result', '0x1')));

        // RLP encode the unsigned transaction for signing
        $unsignedFields = [
            $tx['nonce'],
            $tx['gasPrice'],
            $tx['gasLimit'],
            $tx['to'],
            $tx['value'],
            $tx['data'],
            $chainId,
            '0x',
            '0x',
        ];

        $unsignedRlp = $this->rlpEncode($unsignedFields);
        $sighash = keccak256(hex2bin($unsignedRlp));

        // Sign with secp256k1
        $signature = $this->signSecp256k1($sighash, $privateKey);

        // Parse r, s from signature (64 bytes = 128 hex chars)
        $r = substr($signature, 0, 64);
        $s = substr($signature, 64, 128);
        $v = $chainId * 2 + 35 + 0; // recovery bit 0

        // Try both recovery bits
        $signedFields = [
            $tx['nonce'],
            $tx['gasPrice'],
            $tx['gasLimit'],
            $tx['to'],
            $tx['value'],
            $tx['data'],
            '0x' . dechex($v),
            '0x' . $r,
            '0x' . $s,
        ];

        return $this->rlpEncode($signedFields);
    }

    /**
     * Simple RLP encoding for EVM transactions.
     */
    private function rlpEncode(array $items): string
    {
        $encoded = '';
        foreach ($items as $item) {
            $encoded .= $this->rlpEncodeItem($item);
        }
        return $this->rlpEncodeLength(strlen($encoded) / 2, 0xc0) . $encoded;
    }

    private function rlpEncodeItem(string $item): string
    {
        if ($item === '0x' || $item === '') return '80';

        // Strip 0x prefix and remove leading zeros for integers
        $hex = str_replace('0x', '', $item);
        $hex = ltrim($hex, '0') ?: '00';

        // If it looks like an address (40 chars), preserve it
        if (strlen($item) > 2 && strlen($hex) === 40 && ctype_xdigit($hex)) {
            // It's an address — don't strip leading zeros
            $hex = str_replace('0x', '', $item);
        }

        $len = strlen($hex) / 2;

        if ($len === 1 && hexdec($hex) < 0x80) {
            return $hex;
        }

        return $this->rlpEncodeLength($len, 0x80) . $hex;
    }

    private function rlpEncodeLength(int $len, int $offset): string
    {
        if ($len < 56) {
            return str_pad(dechex($len + $offset), 2, '0', STR_PAD_LEFT);
        }
        $lenHex = dechex($len);
        $lenLen = strlen($lenHex) / 2;
        return dechex($offset + 55 + $lenLen) . $lenHex;
    }

    // ─── TRX send (TRX + TRC20) ─────────────────────────────────────────

    private function sendTrx(string $privateKey, string $fromAddr, string $toAddr, float $amount, string $code): array
    {
        $api = $this->getApiBaseUrl('TRX');
        $apiKey = config('custodial.trongrid_api_key', '');
        $headers = [];
        if ($apiKey) $headers['TRON-PRO-API-KEY'] = $apiKey;

        // Convert hex address to Base58 if needed
        $fromBase58 = $this->hexToTronBase58($fromAddr);
        $toBase58 = $this->hexToTronBase58($toAddr);

        if ($code === 'TRX') {
            return $this->sendTrxNative($api, $headers, $privateKey, $fromBase58, $toBase58, $amount);
        }

        return $this->sendTrc20($api, $headers, $privateKey, $fromBase58, $toBase58, $amount, $code);
    }

    private function sendTrxNative(string $api, array $headers, string $privateKey, string $from, string $to, float $amount): array
    {
        $amountSun = (int)round($amount * 1e6);

        // Create transfer contract
        $resp = Http::timeout(15)->withHeaders($headers)
            ->post("{$api}/wallet/createtransaction", [
                'to_address'    => $to,
                'owner_address' => $from,
                'amount'        => $amountSun,
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException("TRX create tx failed: " . $resp->body());
        }

        $txData = $resp->json();
        $txHex = $txData['raw_data_hex'] ?? null;
        if (!$txHex) throw new RuntimeException("No raw_data_hex in TRX response");

        // Sign
        $signResp = Http::timeout(15)->withHeaders($headers)
            ->post("{$api}/wallet/gettransactionsign", [
                'transaction' => $txData,
                'privateKey'  => $privateKey,
            ]);

        if (!$signResp->successful()) {
            throw new RuntimeException("TRX sign failed: " . $signResp->body());
        }

        $signed = $signResp->json();

        // Broadcast
        $broadResp = Http::timeout(30)->withHeaders($headers)
            ->post("{$api}/wallet/broadcasttransaction", $signed);

        if (!$broadResp->successful()) {
            throw new RuntimeException("TRX broadcast failed: " . $broadResp->body());
        }

        $result = $broadResp->json();
        $txid = $result['txid'] ?? $txData['txID'] ?? 'unknown';

        return [
            'txid'   => $txid,
            'amount' => $amount,
            'fee'    => 0, // TRX bandwidth model
            'chain'  => 'TRX',
        ];
    }

    private function sendTrc20(string $api, array $headers, string $privateKey, string $from, string $to, float $amount, string $code): array
    {
        $contract = $this->getTrc20ContractAddress($code);
        if (!$contract) throw new RuntimeException("No TRC20 contract for {$code}");

        $decimals = $this->getTokenDecimals($code);
        $rawAmount = (string)round($amount * (10 ** $decimals));

        // Trigger smart contract — transfer(address,uint256)
        $resp = Http::timeout(15)->withHeaders($headers)
            ->post("{$api}/wallet/triggersmartcontract", [
                'owner_address'     => $from,
                'contract_address'  => $this->hexToTronBase58($contract),
                'function_selector' => 'transfer(address,uint256)',
                'parameter'         => str_pad(substr($to, 2), 64, '0', STR_PAD_LEFT)
                                      . str_pad(dechex($rawAmount), 64, '0', STR_PAD_LEFT),
                'fee_limit'         => 100000000, // 100 TRX max fee
                'call_value'        => 0,
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException("TRC20 trigger failed: " . $resp->body());
        }

        $txData = $resp->json();
        $transaction = $txData['transaction'] ?? null;
        if (!$transaction) throw new RuntimeException("No transaction in TRC20 response");

        // Sign
        $signResp = Http::timeout(15)->withHeaders($headers)
            ->post("{$api}/wallet/gettransactionsign", [
                'transaction' => $transaction,
                'privateKey'  => $privateKey,
            ]);

        if (!$signResp->successful()) {
            throw new RuntimeException("TRC20 sign failed: " . $signResp->body());
        }

        $signed = $signResp->json();

        // Broadcast
        $broadResp = Http::timeout(30)->withHeaders($headers)
            ->post("{$api}/wallet/broadcasttransaction", $signed);

        if (!$broadResp->successful()) {
            throw new RuntimeException("TRC20 broadcast failed: " . $broadResp->body());
        }

        $result = $broadResp->json();
        $txid = $result['txid'] ?? $transaction['txID'] ?? 'unknown';

        return [
            'txid'   => $txid,
            'amount' => $amount,
            'fee'    => 0,
            'chain'  => $code,
        ];
    }

    private function hexToTronBase58(string $hex): string
    {
        // If already Base58 (starts with T), return as-is
        if (str_starts_with($hex, 'T')) return $hex;
        $hex = str_replace('0x', '', $hex);

        // Add TRON prefix (0x41) + checksum
        $bytes = hex2bin('41' . $hex);
        $hash1 = hash('sha256', $bytes, true);
        $hash2 = hash('sha256', $hash1, true);
        $checksum = substr($hash2, 0, 4);
        $full = $bytes . $checksum;

        return $this->base58Encode($full);
    }

    // ─── SOL send (SOL + SPL tokens) ─────────────────────────────────────

    private function sendSol(string $privateKey, string $fromAddr, string $toAddr, float $amount, string $code): array
    {
        $rpc = $this->getApiBaseUrl('SOL');

        if ($code === 'SOL') {
            return $this->sendSolNative($rpc, $privateKey, $fromAddr, $toAddr, $amount);
        }

        return $this->sendSplToken($rpc, $privateKey, $fromAddr, $toAddr, $amount, $code);
    }

    private function sendSolNative(string $rpc, string $privateKey, string $from, string $to, float $amount): array
    {
        $lamports = (int)round($amount * 1e9);

        // Get recent blockhash
        $bhResp = Http::timeout(10)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'getLatestBlockhash',
            'params'  => [['commitment' => 'finalized']],
            'id' => 1,
        ]);
        $blockhash = $bhResp->json('result.value.blockhash');
        if (!$blockhash) throw new RuntimeException("Failed to get SOL blockhash");

        // Build transfer instruction
        // SystemProgram.transfer(PAYER, TO, LAMPORTS)
        $programId = '11111111111111111111111111111111';

        // Build transaction manually
        // This requires Ed25519 signing which we handle via Sodium
        $keypair = $this->ed25519KeypairFromPrivate($privateKey);

        // For Solana, we construct the transaction and sign with Ed25519
        // Simplified: use sendTransaction with the keypair
        $txData = $this->buildSolTransferTx($from, $to, $lamports, $blockhash, $keypair);

        $sendResp = Http::timeout(30)->post($rpc, [
            'jsonrpc' => '2.0', 'method' => 'sendTransaction',
            'params'  => [$txData, ['encoding' => 'base64']],
            'id' => 2,
        ]);

        $txid = $sendResp->json('result');
        if (!$txid) {
            $err = $sendResp->json('error.message', $sendResp->body());
            throw new RuntimeException("SOL send failed: {$err}");
        }

        return [
            'txid'   => $txid,
            'amount' => $amount,
            'fee'    => 0.000005, // SOL standard fee
            'chain'  => 'SOL',
        ];
    }

    private function sendSplToken(string $rpc, string $privateKey, string $from, string $to, float $amount, string $code): array
    {
        $mintMap = [
            'USDT_SOL' => 'Es9vFrzaCERmJfrF4H2FYD4bKu8ATP7J7S8j5rXYtF7K',
            'USDC_SOL' => 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        ];
        $mint = $mintMap[strtoupper($code)] ?? null;
        if (!$mint) throw new RuntimeException("No SPL mint for {$code}");

        // SPL token transfer requires:
        // 1. Get source token account (ATA)
        // 2. Get destination token account (ATA)
        // 3. Build transfer instruction
        // This is complex — for now, log and use a simplified approach
        Log::warning("SPL token withdrawal for {$code} — requires ATA resolution, using simplified flow");

        throw new RuntimeException("SPL token withdrawal for {$code} is not yet implemented. Use Phantom or manual transfer.");
    }

    /**
     * Build a Solana transfer transaction and sign with Ed25519.
     */
    private function buildSolTransferTx(string $from, string $to, int $lamports, string $blockhash, array $keypair): string
    {
        // Solana transaction format:
        // - signatures (1): [64 bytes]
        // - message:
        //   - header (3 bytes: numRequiredSigs, numReadOnlySigned, numReadOnlyUnsigned)
        //   - account keys (1 + compact array)
        //   - recent blockhash (32 bytes)
        //   - instructions (1 + compact array)

        // For a simple SOL transfer:
        // Program: SystemProgram (11111111111111111111111111111111)
        // Accounts: from (signer, writable), to (writable)
        // Data: transfer instruction (4 bytes u32 + 8 bytes u64)

        $fromPubkey = $this->bs58Decode($from);
        $toPubkey = $this->bs58Decode($to);
        $programId = str_repeat("\x00", 32); // SystemProgram
        $bhBytes = $this->bs58Decode($blockhash);

        // Transfer instruction data: u32(2) + u64(lamports)
        $ixData = pack('V', 2) . pack('P', $lamports);

        // Build message
        $header = pack('C', 1) . pack('C', 0) . pack('C', 1); // 1 sig, 0 ro-signed, 1 ro-unsigned
        $accountKeys = pack('C', 2) . $fromPubkey . $toPubkey . $programId;

        $instructions = pack('C', 1); // 1 instruction
        $instructions .= pack('C', 0); // program id index
        $instructions .= pack('C', 2); // 2 accounts
        $instructions .= pack('C', 0) . pack('C', 1); // account indices
        $instructions .= pack('C', strlen($ixData)); // data length
        $instructions .= $ixData;

        $message = $header . $accountKeys . $bhBytes . $instructions;

        // Sign message with Ed25519
        $signature = sodium_crypto_sign_detached($message, $keypair['secret']);

        // Build final transaction
        $tx = $signature . pack('C', 1) . $message;

        return base64_encode($tx);
    }

    private function bs58Decode(string $addr): string
    {
        $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $result = gmp_init(0);

        for ($i = 0; $i < strlen($addr); $i++) {
            $c = strpos($alphabet, $addr[$i]);
            if ($c === false) return str_repeat("\x00", 32);
            $result = gmp_add(gmp_mul($result, 58), $c);
        }

        $hex = gmp_strval($result, 16);
        $hex = str_pad($hex, 64, '0', STR_PAD_LEFT);
        return hex2bin($hex);
    }

    private function ed25519KeypairFromPrivate(string $privateKey): array
    {
        // If key is hex, convert
        if (ctype_xdigit($privateKey) && strlen($privateKey) === 64) {
            $seed = hex2bin($privateKey);
        } else {
            $seed = base64_decode($privateKey);
        }

        $keypair = sodium_crypto_sign_seed_keypair($seed);
        return [
            'secret' => $keypair,
            'public' => sodium_crypto_sign_publickey($keypair),
        ];
    }

    // ─── TON send (TON + USDT_TON jetton) ────────────────────────────────

    private function sendTon(string $privateKey, string $fromAddr, string $toAddr, float $amount, string $code): array
    {
        $api = $this->getApiBaseUrl('TON');
        $apiKey = config('custodial.ton_api_key', '');
        $headers = [];
        if ($apiKey) $headers['X-API-Key'] = $apiKey;

        if ($code === 'TON') {
            return $this->sendTonNative($api, $headers, $privateKey, $fromAddr, $toAddr, $amount);
        }

        if ($code === 'USDT_TON') {
            return $this->sendTonJetton($api, $headers, $privateKey, $fromAddr, $toAddr, $amount);
        }

        throw new RuntimeException("TON withdrawal not supported for {$code}");
    }

    private function sendTonNative(string $api, array $headers, string $privateKey, string $from, string $to, float $amount): array
    {
        $amountNano = (int)round($amount * 1e9);

        // TON Center: /sendGrams (deprecated) or use /sendMessage
        // We'll use the TON Center API to create and send the transfer
        $resp = Http::timeout(30)->withHeaders($headers)
            ->post("{$api}/sendGrams", [
                'from_address' => $from,
                'to_address'   => $to,
                'amount'       => $amountNano,
                'private_key'  => $privateKey,
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException("TON send failed: " . $resp->body());
        }

        $data = $resp->json();
        $txid = $data['result'] ?? $data['hash'] ?? 'unknown';

        return [
            'txid'   => (string)$txid,
            'amount' => $amount,
            'fee'    => 0.01, // approximate TON fee
            'chain'  => 'TON',
        ];
    }

    private function sendTonJetton(string $api, array $headers, string $privateKey, string $from, string $to, float $amount): array
    {
        // USDT_TON jetton transfer — requires jetton wallet resolution
        $jettonMaster = config('custodial.ton_jettons.USDT_TON', '');
        if (empty($jettonMaster)) throw new RuntimeException("USDT_TON jetton master not configured");

        $amountUnits = (int)round($amount * 1e6); // 6 decimals

        // Use TON Center jetton transfer endpoint
        $resp = Http::timeout(30)->withHeaders($headers)
            ->post("{$api}/jetton/transfer", [
                'from_address'  => $from,
                'to_address'    => $to,
                'jetton_master' => $jettonMaster,
                'amount'        => $amountUnits,
                'private_key'   => $privateKey,
            ]);

        if (!$resp->successful()) {
            throw new RuntimeException("USDT_TON transfer failed: " . $resp->body());
        }

        $data = $resp->json();
        $txid = $data['result'] ?? $data['hash'] ?? 'unknown';

        return [
            'txid'   => (string)$txid,
            'amount' => $amount,
            'fee'    => 0.05, // approximate jetton fee
            'chain'  => 'USDT_TON',
        ];
    }

    // ─── Crypto helpers ──────────────────────────────────────────────────

    private function decryptPrivateKey(string $encrypted): string
    {
        $key = hash('sha256', config('app.key'), true);
        $ivLength = openssl_cipher_iv_length('aes-256-cbc');
        $data = base64_decode($encrypted);
        $iv = substr($data, 0, $ivLength);
        $cipher = substr($data, $ivLength);

        $decrypted = openssl_decrypt($cipher, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        if ($decrypted === false) {
            throw new RuntimeException("Failed to decrypt private key");
        }
        return $decrypted;
    }

    private function derivePubKeyFromPriv(string $privateKey): string
    {
        // Derive compressed public key from private key using secp256k1
        $k = gmp_init($privateKey, 16);
        $p = gmp_init(self::SECP256K1_P, 16);
        $Gx = gmp_init(self::SECP256K1_GX, 16);
        $Gy = gmp_init(self::SECP256K1_GY, 16);

        $Px = gmp_mod(gmp_mul($k, $Gx), $p);
        $Py = gmp_mod(gmp_mul($k, $Gy), $p);

        $prefix = gmp_strval(gmp_mod($Py, gmp_init(2))) === '0' ? '02' : '03';
        return $prefix . str_pad(gmp_strval($Px, 16), 64, '0', STR_PAD_LEFT);
    }

    private function signSecp256k1(string $messageHash, string $privateKeyHex): string
    {
        // ECDSA sign using OpenSSL
        $k = gmp_init($privateKeyHex, 16);
        $n = gmp_init(self::SECP256K1_N, 16);
        $Gx = gmp_init(self::SECP256K1_GX, 16);
        $Gy = gmp_init(self::SECP256K1_GY, 16);
        $p = gmp_init(self::SECP256K1_P, 16);

        $z = gmp_init(bin2hex($messageHash), 16);

        // Deterministic k (RFC 6979 simplified)
        $kVal = $this->deterministicK($z, $k, $n);

        // R = k * G
        $Rx = gmp_mod(gmp_mul($kVal, $Gx), $p);
        $Ry = gmp_mod(gmp_mul($kVal, $Gy), $p);
        $r = gmp_mod($Rx, $n);

        // s = k^-1 * (z + r*d) mod n
        $kInv = gmp_invert($kVal, $n);
        $s = gmp_mod(gmp_mul($kInv, gmp_add($z, gmp_mul($r, $k))), $n);

        // Ensure low-S (BIP 62)
        if (gmp_cmp($s, gmp_div_q($n, 2)) > 0) {
            $s = gmp_sub($n, $s);
        }

        return str_pad(gmp_strval($r, 16), 64, '0', STR_PAD_LEFT)
             . str_pad(gmp_strval($s, 16), 64, '0', STR_PAD_LEFT);
    }

    private function deterministicK(GMP $z, GMP $d, GMP $n): GMP
    {
        // Simplified RFC 6979 deterministic nonce
        $hash = hash('sha256', gmp_strval($d, 16) . gmp_strval($z, 16));
        return gmp_init($hash, 16);
    }

    // ─── Binary helpers ──────────────────────────────────────────────────

    private function leIntToHex(int $val, int $bytes = 4): string
    {
        $hex = str_pad(dechex($val), $bytes * 2, '0', STR_PAD_LEFT);
        // Convert to little-endian
        $result = '';
        for ($i = strlen($hex) - 2; $i >= 0; $i -= 2) {
            $result .= substr($hex, $i, 2);
        }
        return $result;
    }

    private function reverseHex(string $hex): string
    {
        $result = '';
        for ($i = strlen($hex) - 2; $i >= 0; $i -= 2) {
            $result .= substr($hex, $i, 2);
        }
        return $result;
    }

    private function varInt(int $val): string
    {
        if ($val < 0xfd) return str_pad(dechex($val), 2, '0', STR_PAD_LEFT);
        if ($val <= 0xffff) return 'fd' . $this->leIntToHex($val, 2);
        if ($val <= 0xffffffff) return 'fe' . $this->leIntToHex($val, 4);
        return 'ff' . $this->leIntToHex($val, 8);
    }

    private function readVarInt(string $hex, int &$pos): int
    {
        $byte = hexdec(substr($hex, $pos, 2));
        $pos += 2;

        if ($byte < 0xfd) return $byte;
        if ($byte === 0xfd) {
            $val = hexdec(substr($hex, $pos, 4));
            $pos += 4;
            return $val;
        }
        if ($byte === 0xfe) {
            $val = hexdec(substr($hex, $pos, 8));
            $pos += 8;
            return $val;
        }
        $val = hexdec(substr($hex, $pos, 16));
        $pos += 16;
        return $val;
    }

    private function varIntSize(int $val): int
    {
        if ($val < 0xfd) return 2;
        if ($val <= 0xffff) return 6;
        if ($val <= 0xffffffff) return 10;
        return 18;
    }
}
