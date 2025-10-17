### Ejection Redirect API

Simple import endpoint to create/update a multisig wallet from an external data dump and return an invite URL.

### Endpoint

- POST `/api/v1/ejection/redirect`

### What it does

- Validates incoming rows for a multisig import.
- Upserts a `NewWallet` with signer data, `paymentCbor` (from `payment_script`), and `stakeCbor` (from `stake_script`).
- Returns the invite URL for the newly imported wallet.

### Request body

Send an array of rows. Each row should include:

- Required per row:
  - `user_id` (string)
  - `user_stake_pubkey_hash_hex` (56-char lowercase hex)
- Shared across all rows (values must match for every row):
  - `multisig_id`
  - `multisig_name`
  - `multisig_address` (validated)
  - `payment_script` (CBOR hex of native script)
  - `stake_script`
- Optional per row:
  - `user_address_bech32`
  - `user_name`
  - `community_description`

Minimal example payload:

```json
[
  {
    "multisig_id": "104ce812-bbd1...2ee0a",
    "multisig_name": "Team Treasury",
    "multisig_address": "addr1...7nj",
    "payment_script": "82018183...34",
    "stake_script": "82018183...34",
    "user_id": "51d3015c-04b1...107eb",
    "user_name": "Bob",
    "user_address_bech32": "",
    "user_stake_pubkey_hash_hex": "5a4006...5b1"
  },
  {
    "multisig_id": "104ce812-bbd1...2ee0a",
    "multisig_name": "Team Treasury",
    "multisig_address": "addr1...7nj",
    "payment_script": "82018183...34",
    "stake_script": "82018183...34",
    "user_id": "97f9d721-7246...76",
    "user_name": "Carol",
    "user_address_bech32": "addr1...3zka",
    "user_stake_pubkey_hash_hex": "f7f32d1a...9d1"
  },
]
```

### Curl example

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '[
    {"multisig_id":"msig_123","multisig_name":"Team Treasury","multisig_address":"addr1...","payment_script":"4a50...c0","user_id":"u1","user_stake_pubkey_hash_hex":"abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"},
    {"multisig_id":"msig_123","user_id":"u2","user_stake_pubkey_hash_hex":"1234123412341234123412341234123412341234123412341234"}
  ]' \
  https://multisig.meshjs.dev/api/v1/ejection/redirect
```

### Response

```json
{
  "ok": true,
  "receivedAt": "2025-10-13T17:50:10.123Z",
  "multisigAddress": "addr1...",
  "dbUpdated": true,
  "inviteUrl": "https://multisig.meshjs.dev/wallets/invite/<newWalletId>"
}
```

### Notes

- CORS is enabled; `OPTIONS` requests return 200.
- If a `multisig_id` is supplied, the wallet is upserted with that id; otherwise a new id is created.
- The first non-empty `community_description` is used for the wallet description (HTML tags are stripped).
- If the database write fails, `dbUpdated` will be `false` and `inviteUrl` will be `null`.

