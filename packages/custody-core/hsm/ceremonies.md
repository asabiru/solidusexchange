# Key Ceremony Scripts and Runbook Templates

Dev-only drafts per `hsm-custody-program.md` §"Engineering work possible now".
Every script is a checklist the ceremony master runs; production numbers
(thresholds, device serials, custodians) are filled at rehearsal on the lab
HSM, never from this file.

## General ceremony frame

Every ceremony — initialization, key generation, backup, share distribution,
recovery, rotation, firmware upgrade, destruction — runs this frame:

- [ ] Written script version rehearsed on the lab HSM in the last 30 days
- [ ] Dedicated room: continuous video, no personal devices, attendance log with handwritten signatures
- [ ] Two independent witnesses; external-audit witness for every production root ceremony
- [ ] Air-gapped ceremony computer booted from the verified reproducible image
- [ ] Tamper-evident bag/seal serials logged before and after each item
- [ ] Ceremony aborts and restarts on any script deviation
- [ ] Public-key hashes, configuration hashes and log digests recorded into the audit-evidence store
- [ ] Ceremony computer sealed or destroyed after close-out

## C-01 — HSM initialization (per device)

1. Verify vendor shipment: tamper packaging intact, serial matches chain-of-custody record, direct vendor channel confirmed.
2. Inspect device physically; log condition.
3. Power on in the ceremony room with network isolated.
4. Run vendor firmware integrity check; record firmware version + hash.
5. Initialize security world / domains per vendor procedure; never set "legacy compatibility" modes.
6. Configure M-of-N administrative quorum on physical tokens/smart cards.
7. Distribute tokens: one per security officer, no person holding two roles.
8. Record device inventory entry: serial, firmware hash, site, tier assignment.
9. Close-out: witnesses sign the attendance + device record.

Evidence produced: serial, firmware hash, quorum config record, officer token assignments.

## C-02 — Root key generation (per chain+tier+environment)

Pre-conditions: D-002/D-003 decision recorded; vendor proof-of-concept passed for the curve (Ed25519 TON / secp256k1 TRON); rehearsal completed.

1. Confirm ceremony quorum of custodians for the tier (cold: 3-of-5, warm: 2-of-3).
2. Generate the root key inside the HSM; mark non-exportable; never export plaintext.
3. Derive the public key/address; hash it into the evidence store.
4. Create the wrapped backup blob to an identical certified device class.
5. Split/distribute card shares per custodian; log each share's sealed bag.
6. Record key inventory entry: `key_id`, purpose, chain, tier, HSM serial, ceremony id, custodians — no key material.
7. Run functional check: sign a throwaway testnet message inside the boundary; verify outside; destroy the test artifact.
8. Close-out: witnesses sign; custody log sealed.

## C-03 — Backup creation

1. Verify the backup target is an identical certified device.
2. Initiate wrapped backup; confirm wrap algorithm + M-of-N card set.
3. Seal backup device + card set; distribute to the two vaults (no single site holds restoring threshold).
4. Record backup inventory entry with bag/seal serials.

## C-04 — Share distribution / re-share

1. On custodian change or share compromise: schedule ceremony within the role's deadline.
2. Re-share or rotate per vendor procedure; never re-use old shares.
3. Attest each new share's sealed delivery to its custodian.

## C-05 — Recovery drill (quarterly on non-production keys)

1. Restage a wrapped backup onto a lab device in the ceremony room.
2. Rebuild the security world from the card set; verify public keys match the inventory.
3. Full annual exercise extends to a complete cold-recovery scenario.

## C-06 — Rotation

1. Generate replacement root under a fresh ceremony.
2. Drain: queue signed transfers from old addresses through the normal policy path (never an emergency direct move).
3. Mark old key retired in inventory; archive its evidence.
4. Destruction ceremony for retired material after the grace window.

## C-07 — Firmware upgrade

1. Verify vendor signature + advisory context on the candidate image.
2. Rehearse on the lab HSM; document the vendor-approved upgrade path.
3. Apply under quorum; record before/after firmware hashes.
4. Post-upgrade functional check; re-attest inventory row.

## C-08 — Destruction

1. Confirm the key is retired and all assets drained (chain-verified zero balances).
2. Zeroize per vendor procedure; physically destroy under dual control + video.
3. Record the destruction act with witnesses.

## Key inventory register (template)

One row per key — never contains material:

| Field | Example |
|---|---|
| `key_id` | `key_ton_cold_prod_001` |
| `purpose` | `cold-tier TON root` |
| `chain` | `TON` / `TRON` |
| `tier` | `hot` / `warm` / `cold` |
| `environment` | `testnet` / `mainnet` |
| `hsm_serial` | `THALES-...` (vendor serial) |
| `ceremony_id` | `C-02-2026-XXXX` |
| `custodians` | list of subject references |
| `created_at` | timestamp |
| `status` | `active` / `retired` / `destroyed` |
| `address_reference` | `custody_address_ref_*` — never a raw address |
| `evidence_digest` | SHA-256 of the ceremony evidence pack |

## Incident bridges

Any ceremony deviation → abort + incident per `incident-response.md`. Tamper
seal break, failed integrity check or unexplained quorum evidence → immediate
`freeze` on the tier (any single security officer), full quorum to lift.
