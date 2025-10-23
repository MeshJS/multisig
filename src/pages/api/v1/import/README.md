### Import Summon API

Simple import endpoint to create/update a multisig wallet from an external data dump and return an invite URL.

### Endpoint

- POST `/api/v1/import/summon`

### What it does

- Validates an incoming `{ community, multisig, users }` payload for a multisig import.
- Upserts a `NewWallet` with signer data, `paymentCbor` (from `multisig.payment_script`), and `stakeCbor` (from `multisig.stake_script`).
- Returns the invite URL for the newly imported wallet.

### Request body

Send a single JSON object with these properties:

- `community` (object)
  - `id` (string)
  - `name` (string)
  - `description` (string; HTML allowed, tags are stripped for storage)
  - `profile_photo_url` (string)
  - `verified` (boolean)
  - `verified_name` (string)
- `multisig` (object)
  - `id` (string)
  - `name` (string)
  - `address` (string; validated)
  - `created_at` (string; ISO or timestamp-like)
  - `payment_script` (string; CBOR hex of native script)
  - `stake_script` (string; CBOR hex of native script)
- `users` (array of objects)
  - `id` (string)
  - `name` (string)
  - `address_bech32` (string; optional)
  - `stake_pubkey_hash_hex` (string; 56-char lowercase hex; required)
  - `ada_handle` (string; optional)
  - `profile_photo_url` (string; optional)

Minimal example payload:

```json
{
  "community": {
    "id": "28e2bee1-9b21-4393-bf7b-ec68c012a795",
    "name": "Smart Contract Audit Token (SCATDAO)",
    "description": "<p>A DAO for decentralized audits, research, and safety on Cardano. </p>",
    "profile_photo_url": "https://scatdao.b-cdn.net/wp-content/uploads/2021/09/scatdao_graphic.png",
    "verified": true,
    "verified_name": "scatdao"
  },
  "multisig": {
    "id": "40b18160-684c-42b2-8523-577165bba8ec",
    "name": "Test Community Treasury 2024/25 (1)",
    "address": "addr1x809f8t6jy...",
    "created_at": "2024-12-06 10:12:39.606+00",
    "payment_script": "82018183030386...",
    "stake_script": "82018183030386..."
  },
  "users": [
    {
      "id": "1876cf5b-37c7-4785-8194-73751134ddbe",
      "name": "Alice",
      "address_bech32": "addr1q8772af8wuvzksqx5p679p5wqsq...",
      "stake_pubkey_hash_hex": "40b39bac8ce1b8b527899f8ad19e51...",
      "ada_handle": "",
      "profile_photo_url": ""
    },
    {
      "id": "af2b5725-accb-4de9-8fdc-5f439848a2cc",
      "name": "Bob",
      "address_bech32": "",
      "stake_pubkey_hash_hex": "b7d2352a2a8a6661df9657f3fbe93a...",
      "ada_handle": "",
      "profile_photo_url": ""
    }
  ]
}
```

### Curl example

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "community": {"id": "c1", "name": "Team", "description": "<p>Our team treasury</p>", "verified": true, "verified_name": "team"},
    "multisig": {"id": "msig_123", "name": "Team Treasury", "address": "addr1...", "payment_script": "4a50...c0", "stake_script": "4a50...c0"},
    "users": [
      {"id": "u1", "name": "Bob", "address_bech32": "", "stake_pubkey_hash_hex": "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"},
      {"id": "u2", "name": "Carol", "address_bech32": "addr1...3zka", "stake_pubkey_hash_hex": "1234123412341234123412341234123412341234123412341234"}
    ]
  }' \
  https://multisig.meshjs.dev/api/v1/import/summon
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

- Only the`{ community, multisig, users }` shape is accepted.
- The wallet description prefers `community.description` (HTML tags are stripped); 
- If a `multisig.id` is supplied, the wallet is upserted with that id; otherwise a new id is created.
- The raw request body is stored in `NewWallet.rawImportBodies`.
- CORS is enabled; `OPTIONS` requests return 200.
- If the database write fails, `dbUpdated` will be `false` and `inviteUrl` will be `null`.