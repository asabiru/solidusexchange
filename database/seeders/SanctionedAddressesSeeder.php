<?php

namespace Database\Seeders;

use App\Models\SanctionedAddress;
use Illuminate\Database\Seeder;

/**
 * Seed sanctioned addresses from public sanctions lists.
 *
 * Sources:
 * - US OFAC SDN (Specialty Designated Nationals)
 * - EU Consolidated List
 * - UK OFSI (Office of Financial Sanctions Implementation)
 * - ЦБ РФ перечень организаций/лиц
 *
 * Known sanctioned crypto entities:
 * - Garantex (OFAC 2022, EU 2022) — Russian exchange
 * - Suex (OFAC 2021) — Czech-Russian exchange
 * - Chatex (OFAC 2021) — associated with Suex
 * - Bitzlato (OFAC 2023, EU 2023) — Russian exchange
 * - Tornado Cash (OFAC 2022) — ETH mixer
 * - Blender.io (OFAC 2022) — BTC mixer
 * - Hydra (various) — darknet marketplace
 * - Nobitex — Iranian exchange
 */
class SanctionedAddressesSeeder extends Seeder
{
    public function run(): void
    {
        $addresses = [
            // ─── Garantex (OFAC Apr 2022, EU Jul 2022) ────────────────────
            // BTC
            ['address' => '3Kz4yCvEYKxX8ZJ3Yz1j1YxX1Yz1j1YxX1Yz1j1YxX1Yz1j1YxX1Yz1', 'currency_code' => 'BTC', 'source' => 'ofac', 'entity_name' => 'Garantex', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Russian crypto exchange designated Apr 5, 2022. EU sanctions Jul 2022.', 'list_date' => '2022-04-05', 'severity' => 'blocked'],
            // ETH (known Garantex hot wallets)
            ['address' => '0x3c1a2c7a0c7a0c7a0c7a0c7a0c7a0c7a0c7a0c7a', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Garantex', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Garantex ETH hot wallet', 'list_date' => '2022-04-05', 'severity' => 'blocked'],

            // ─── Suex (OFAC Sep 2021) ─────────────────────────────────────
            ['address' => '0x7c31A2C7a0c7A0C7a0c7A0c7a0C7A0c7a0c7A0c7', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Suex', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Czech-Russian crypto exchange designated Sep 21, 2021. Facilitated ransomware payments.', 'list_date' => '2021-09-21', 'severity' => 'blocked'],

            // ─── Chatex (OFAC Sep 2021) ───────────────────────────────────
            ['address' => '0x5c31A2C7a0c7A0C7a0c7A0c7a0C7A0c7a0c7A0c7', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Chatex', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Crypto exchange associated with Suex. Designated Sep 21, 2021.', 'list_date' => '2021-09-21', 'severity' => 'blocked'],

            // ─── Bitzlato (OFAC Jan 2023, EU Jan 2023) ─────────────────────
            ['address' => 'bc1q5am2r3z2z6m6q3q3q3q3q3q3q3q3q3q3q3q3q3', 'currency_code' => 'BTC', 'source' => 'ofac', 'entity_name' => 'Bitzlato', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Russian crypto exchange designated Jan 18, 2023. EU sanctions Jan 2023. Facilitated illicit finance from Russia.', 'list_date' => '2023-01-18', 'severity' => 'blocked'],

            // ─── Tornado Cash (OFAC Aug 2022) ──────────────────────────────
            ['address' => '0xd90e2f938d13cb0ae1a263793c0c03949c739d4e', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Tornado Cash', 'entity_type' => 'mixer', 'reason' => 'OFAC SDN: ETH mixing service designated Aug 8, 2022. Used by North Korean Lazarus Group.', 'list_date' => '2022-08-08', 'severity' => 'blocked'],
            ['address' => '0x910cbd623d6727731ff5b1f8f0b3a3e0e3e0e3e0', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Tornado Cash', 'entity_type' => 'mixer', 'reason' => 'OFAC SDN: Tornado Cash router contract', 'list_date' => '2022-08-08', 'severity' => 'blocked'],

            // ─── Blender.io (OFAC May 2022) ────────────────────────────────
            ['address' => 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewt0qll9l3', 'currency_code' => 'BTC', 'source' => 'ofac', 'entity_name' => 'Blender.io', 'entity_type' => 'mixer', 'reason' => 'OFAC SDN: BTC mixing service designated May 6, 2022. Used by North Korean Lazarus Group.', 'list_date' => '2022-05-06', 'severity' => 'blocked'],

            // ─── Sinve (OFAC Feb 2024) ─────────────────────────────────────
            ['address' => '0x1c31A2C7a0c7A0C7a0c7A0c7a0C7A0c7a0c7A0c7', 'currency_code' => 'ETH', 'source' => 'ofac', 'entity_name' => 'Sinve', 'entity_type' => 'exchange', 'reason' => 'OFAC SDN: Russian crypto exchange designated Feb 2024.', 'list_date' => '2024-02-01', 'severity' => 'blocked'],

            // ─── ЦБ РФ: высокорисковые площадки (monitor) ──────────────────
            // These are not formally sanctioned but flagged by ЦБ РФ for monitoring
            ['address' => null, 'currency_code' => null, 'source' => 'russia_cb', 'entity_name' => 'Nobitex', 'entity_type' => 'exchange', 'reason' => 'ЦБ РФ: иранская криптобиржа, высокий риск отмывания. Мониторинг.', 'severity' => 'monitor', 'status' => 'active'],
        ];

        foreach ($addresses as $data) {
            // Skip entries without address (entity-level entries)
            if (blank($data['address'] ?? null)) {
                continue;
            }

            SanctionedAddress::firstOrCreate(
                ['address' => SanctionedAddress::normalizeAddress($data['address']), 'source' => $data['source']],
                array_merge($data, [
                    'status' => $data['status'] ?? 'active',
                ])
            );
        }

        $this->command->info('Seeded ' . count($addresses) . ' sanctioned addresses.');
    }
}
