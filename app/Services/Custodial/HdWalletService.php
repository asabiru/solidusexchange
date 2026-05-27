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
 * - LTC: litecoin.space API (free)
 * - ETH/EVM: Public RPC nodes (free)
 * - TRX: TronGrid API (free tier)
 * - SOL: Solana RPC (free)
 * - BNB: BSC RPC (free)
 * - TON: TON API (free tier)
 */
class HdWalletService
{
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

        return match ($normalized) {
            'BTC'  => config('custodial.btc_api', 'https://blockstream.info/api'),
            'LTC'  => config('custodial.ltc_api', 'https://litecoin.space/api'),
            'ETH'  => config('custodial.eth_rpc', 'https://eth.llamarpc.com'),
            'BNB'  => config('custodial.bsc_rpc', 'https://bsc-dataseed.binance.org'),
            'TRX'  => config('custodial.trx_api', 'https://api.trongrid.io'),
            'SOL'  => config('custodial.sol_rpc', 'https://api.mainnet-beta.solana.com'),
            'TON'  => config('custodial.ton_api', 'https://toncenter.com/api/v2'),
            default => throw new RuntimeException("No API endpoint configured for {$currencyCode}"),
        };
    }

    /**
     * Normalize currency code to base chain.
     */
    public function normalizeCode(string $code): string
    {
        $code = strtoupper(trim($code));

        if (str_ends_with($code, '_TRC20') || $code === 'TRX')  return 'TRX';
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
    private function getTonAddressFromSeed(string $seed, int $index): string
    {
        $subSeed = hash_hmac('sha256', $seed, "ton-{$index}", true);

        $keypair = sodium_crypto_sign_seed_keypair($subSeed);
        $publicKey = sodium_crypto_sign_publickey($keypair);

        // TON address: raw format
        // wallet_id (0x00) + public_key + workchain (0x00 for basechain)
        // Simplified: UQ + base64url-encoded bytes
        $raw = "\x00" . $publicKey;

        // CRC16-XMODEM
        $crc = $this->crc16Xmodem($raw);
        $raw .= pack('n', $crc);

        // Base64url encode
        $b64 = rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
        return 'UQ' . $b64;
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

    // ─── LTC deposits via litecoin.space API ──────────────────────────────

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

        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/getTransactions", [
                'address' => $wallet->address,
                'limit'   => 10,
            ]);

        if (!$response->successful()) {
            return [];
        }

        $result = $response->json('result', []);
        $deposits = [];

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
}
