# Reference bot client

Minimal client to test the multisig v1 bot API. Use it from the Cursor agent or locally.

## Config

Use config in two phases:

1. Registration/claim phase (before credentials exist):

```json
{
  "baseUrl": "http://localhost:3000",
  "paymentAddress": "<Cardano payment address for this bot>"
}
```

2. Authenticated phase (after pickup):

```json
{
  "baseUrl": "http://localhost:3000",
  "botKeyId": "<from GET /api/v1/botPickupSecret>",
  "secret": "<from GET /api/v1/botPickupSecret>",
  "paymentAddress": "<Cardano payment address for this bot>"
}
```

- **baseUrl**: API base (e.g. `http://localhost:3000` for dev).
- **botKeyId** / **secret**: Returned by `GET /api/v1/botPickupSecret` after a human claims the bot.
- **paymentAddress**: The bot’s **own** Cardano payment address (a wallet the bot controls, not the owner’s address). One bot, one address. Required for `auth` and for all authenticated calls.

Provide config in one of these ways:

1. **Env**  
   `BOT_CONFIG='{"baseUrl":"http://localhost:3000","botKeyId":"...","secret":"...","paymentAddress":"addr1_..."}'`

2. **File**  
   Save the JSON as `bot-config.json` in the current directory, or set `BOT_CONFIG_PATH` to the file path.

## Commands

From repo root (or from `scripts/bot-ref` with config in cwd):

```bash
cd scripts/bot-ref
npm install
```

### 1. Register -> claim -> pickup -> auth

1. Bot self-registers and receives a claim code:

```bash
curl -sS -X POST http://localhost:3000/api/v1/botRegister \
   -H "Content-Type: application/json" \
   -d '{"name":"Reference Bot","paymentAddress":"addr1_xxx","scopes":["multisig:read"]}'
```

Response includes `pendingBotId` and `claimCode`.

2. Human claims the bot in the app by entering `pendingBotId` and `claimCode`.

3. Bot picks up credentials:

```bash
curl -sS "http://localhost:3000/api/v1/botPickupSecret?pendingBotId=<pendingBotId>"
```

Response includes `botKeyId` and `secret`.

4. Set config with `botKeyId`, `secret`, and `paymentAddress`, then authenticate to get a JWT:

```bash
BOT_CONFIG='{"baseUrl":"http://localhost:3000","botKeyId":"YOUR_KEY","secret":"YOUR_SECRET","paymentAddress":"addr1_xxx"}' npx tsx bot-client.ts auth
```

Or with a config file:

```bash
# bot-config.json has baseUrl, botKeyId, secret, paymentAddress
npx tsx bot-client.ts auth
```

Prints `{ "token": "...", "botId": "..." }`. Set `BOT_TOKEN` to the token for the next steps.

### 2. List wallet IDs

```bash
export BOT_TOKEN='<token from auth>'
# BOT_CONFIG or bot-config.json must still have baseUrl and paymentAddress
npx tsx bot-client.ts walletIds
```

### 3. Pending transactions

```bash
npx tsx bot-client.ts pendingTransactions <walletId>
```

### 4. Free UTxOs

```bash
npx tsx bot-client.ts freeUtxos <walletId>
```

### 5. Bot “me” (owner address)

```bash
npx tsx bot-client.ts botMe
```

Returns the bot’s own info: `botId`, `paymentAddress`, `displayName`, `botName`, **`ownerAddress`** (the address of the human who claimed the bot). No `paymentAddress` in config needed for this command.

### 6. Owner info

```bash
npx tsx bot-client.ts ownerInfo <walletId>
```

Returns `ownerAddress`, `type` (`user` | `bot` | `all` | null), and optional `user` or `bot` details.

### 7. Create wallet (API)

The bot must have the **multisig:create** scope. Create a JSON payload with at least `name` and `signersAddresses`, then:

```bash
# From file
npx tsx bot-client.ts createWallet create-wallet-payload.json

# From stdin
echo '{"name":"Me and Bot","signersAddresses":["addr1_your...","addr1_bot..."],"numRequiredSigners":2}' | npx tsx bot-client.ts createWallet
```

Optional fields: `description`, `signersDescriptions`, `signersStakeKeys`, `signersDRepKeys`, `numRequiredSigners`, `scriptType` (`atLeast`|`all`|`any`), `stakeCredentialHash`, `network` (0=testnet, 1=mainnet).

### 8. Generate a bot wallet (testing)

From **repo root**: `npx tsx scripts/bot-ref/generate-bot-wallet.ts` — creates gitignored `bot-wallet.json` (mnemonic + address) and updates `bot-config.json`.

### 9. Create “Me and Bot” 2-of-2 wallet

```bash
cd scripts/bot-ref && npx tsx create-wallet-us.ts
```

Uses the owner’s address from `botMe` and the bot’s address from config. **The bot must have its own wallet and address** (not the same as the owner). Set `paymentAddress` in `bot-config.json` to the bot’s Cardano address, complete register -> claim -> pickup, then run `auth` and this script.

## Cursor agent testing

1. Self-register the bot (`POST /api/v1/botRegister`) and capture `pendingBotId` + `claimCode`.
2. Claim it in the app using that ID/code (User page -> Claim a bot).
3. Call `GET /api/v1/botPickupSecret?pendingBotId=...` and place `botKeyId` + `secret` in `scripts/bot-ref/bot-config.json` with the bot `paymentAddress`.
4. Run auth and use the token:

```bash
cd /path/to/multisig/scripts/bot-ref
BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts auth
# Then for walletIds (set BOT_TOKEN from auth output):
BOT_TOKEN='...' BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts walletIds
```

The reference client only uses **bot-key auth** (POST /api/v1/botAuth). Wallet-based auth (getNonce + sign + authSigner) would require a real Cardano signer; implement that in your bot if needed.

## Governance bot flow

For governance automation, request and approve these bot scopes during register/claim:

- `governance:read` to call `GET /api/v1/governanceActiveProposals`
- `ballot:write` to call `POST /api/v1/botBallotsUpsert`

Typical sequence:

1. `POST /api/v1/botAuth` -> get bot JWT
2. `GET /api/v1/governanceActiveProposals?network=0|1&details=false`
3. Bot decides `Yes`/`No`/`Abstain` + optional `rationaleComment`
4. `POST /api/v1/botBallotsUpsert` with `{ walletId, ballotId|ballotName, proposals[] }`
5. Human reviews draft rationale in UI and uploads to IPFS via the existing "Upload to IPFS & Save" action

Notes:

- `proposalId` format is `<txHash>#<certIndex>`.
- Bots cannot set `anchorUrl` or `anchorHash`; only `rationaleComment` draft text is accepted.
- If `ballotName` matches multiple governance ballots, the API returns `409`; use `ballotId` to disambiguate.
