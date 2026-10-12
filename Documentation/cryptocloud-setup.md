# CryptoCloud Setup

> **Status: legacy documentation.** Describes the legacy Laravel application at the repository root. The repo posture is dev-only/synthetic (see `Documentation/regulated-core/`): do not configure live provider credentials or production endpoints here — liquidity, custody and payout decisions remain open in the decision register (D-002/D-003/D-007).

Use `CryptoCloud` as the automatic crypto method when `CoinPayments` is unavailable.

## Required keys

Create a project in `CryptoCloud` and collect:

- `API KEY`
- `SHOP ID`
- `SECRET KEY`
- `PAYOUT API KEY` from the `Security` section

## Project webhook

In the CryptoCloud project settings set the notification URL to:

```text
https://your-domain.example/api/deposit/webhook/crypto_cloud
```

This project resolves exchange and sell requests automatically by deposit address, so one project webhook is enough.

## Method parameters

Open `Admin -> Crypto Methods -> CryptoCloud` and fill:

- `api_key`
- `shop_id`
- `secret_key`
- `payout_api_key`
- `currency_map`

`currency_map` supports JSON or line pairs:

```text
USDT=USDT_TRC20
USDC=USDC_ERC20
```

Use it whenever the project currency code is different from CryptoCloud's full code.

## Notes

- Static wallets are used for incoming deposits because the project expects a direct wallet address on the payment step.
- CryptoCloud POSTBACK is verified with `SECRET KEY`.
- Automatic admin payout uses `PAYOUT API KEY`.
- `TON` and `USDT_TON` are not enabled in this integration because CryptoCloud static wallets are not supported on the TON network.
