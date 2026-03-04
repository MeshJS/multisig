# Bot Autonomous Registration with Claim Code

## Problem Statement

The current bot onboarding flow requires a human to:

1. Create a bot key in the UI (receives `botKeyId` + `secret`)
2. Copy the JSON blob and paste it into the bot's config/chat

**UX issue:** This encourages bot owners to paste the JWT or secret directly into chat interfaces (Discord, Telegram, etc.), risking credential exposure. The secret is shown only once and must be manually transferred — a friction point that leads to insecure sharing habits.

## Proposed Flow: Bot Self-Registration + Claim Code

### Overview

Flip the onboarding: let the **bot register itself first**, then have the **human claim it** using a one-time claim code displayed by the bot. No secrets ever need to leave the bot's environment.

### Sequence

```
Bot                          API                         Human (UI)
 │                            │                            │
 ├─── POST /botRegister ─────►│                            │
 │    { name, paymentAddr,    │                            │
 │      stakeAddr?, scopes }  │                            │
 │                            │── create PendingBot ──►    │
 │                            │── create BotClaimToken ──► │
 │◄── { pendingBotId,        │                            │
 │      claimCode,            │                            │
 │      claimExpiresAt } ─────│                            │
 │                            │                            │
 │  (bot displays claimCode   │                            │
 │   to its operator in the   │                            │
 │   bot's own UI/logs)       │                            │
 │                            │                            │
 │                            │◄── POST /botClaim ─────────┤
 │                            │    { pendingBotId,         │
 │                            │      claimCode }           │
 │                            │    (authed as human JWT)   │
 │                            │                            │
 │                            │── create BotKey + BotUser ─│
 │                            │── link ownerAddress ──►    │
 │                            │── mark token consumed ──►  │
 │                            │                            │
 │                            │──► { botKeyId, botId } ───►│
 │                            │                            │
 │─── GET /botPickupSecret ──►│                            │
 │    ?pendingBotId=...       │                            │
 │                            │── check CLAIMED, return ──►│
 │◄── { botKeyId, secret } ───│    secret once, mark done  │
 │                            │                            │
 │  (bot stores secret and    │                            │
 │   uses POST /botAuth       │                            │
 │   going forward)           │                            │
 │                            │                            │
```

### Design Decisions

---

#### 1. Bot authentication on first contact (before claimed)

- `POST /botRegister` is unauthenticated
- Protected by strict rate limit (5/min per IP) + IP throttling
- 10-minute claim code expiry + 3 max attempts + auto-cleanup of expired records
- Unclaimed registrations are low-value to attackers since they just expire
- Claim code acts as the trust anchor
- Future enhancement: address proof via nonce signing if squatting becomes an issue

---

#### 2. Claim code format and lifetime

| Property | Proposed Value | Notes |
|----------|---------------|-------|
| Format | Random base64url string | Generated via `generateClaimCode()` (same as reference app) |
| Min length | 24 characters | High entropy, copy-paste friendly |
| Storage | Only `sha256(claimCode)` stored as `tokenHash` | Plain code shown only once at registration |
| Lifetime | 10 minutes | Short enough to limit window, long enough for human to switch to browser |
| Attempts | 3 max | Lock out pending bot after 3 failed claims |
| Delivery | Returned to bot in registration response | Bot displays it however it wants (log, chat msg, etc.) |

---

#### 3. Post-claim: secret pickup

- On claim, server generates `secret`, hashes it, creates `BotKey` + `BotUser`, marks claim token consumed (`consumedAt = now`)
- Encrypted secret stored on `PendingBot.secretCipher` for one-time pickup
- Bot polls `GET /botPickupSecret?pendingBotId=...` using the `pendingBotId` it received at registration
- `pendingBotId` is a cuid (non-guessable) — acts as the bearer credential for pickup
- Returns `{ botKeyId, secret }` once, then clears the stored secret and marks pickup done
- Bot stores the secret and uses normal `POST /botAuth` going forward
- Human never sees the secret

---

#### 4. Scope negotiation

- Bot requests scopes during registration: `{ scopes: ["multisig:read", "ballot:write"] }`
- Human sees requested scopes during claim and can **approve or narrow** them
- Final scopes stored on the `BotKey` as today

---

### New Database Models

```prisma
model PendingBot {
  id              String           @id @default(cuid())
  name            String                               // Bot display name
  paymentAddress  String                               // Bot's Cardano address
  stakeAddress    String?                              // Optional
  requestedScopes String                               // JSON array of requested scopes
  status          PendingBotStatus @default(UNCLAIMED)
  claimedBy       String?                              // ownerAddress of the claiming human
  secretCipher    String?                              // Encrypted secret (set on claim, cleared on pickup)
  pickedUp        Boolean          @default(false)     // Whether bot picked up credentials
  expiresAt       DateTime                             // Registration expiry (10 min from creation)
  createdAt       DateTime         @default(now())
  claimToken      BotClaimToken?

  @@index([paymentAddress])
  @@index([expiresAt])
}

enum PendingBotStatus {
  UNCLAIMED
  CLAIMED
}

model BotClaimToken {
  id           String     @id @default(cuid())
  pendingBotId String     @unique
  pendingBot   PendingBot @relation(fields: [pendingBotId], references: [id], onDelete: Cascade)
  tokenHash    String                         // SHA-256 hash of the claim code
  attempts     Int        @default(0)         // Failed verification attempts
  expiresAt    DateTime                       // Token expiry (10 min)
  consumedAt   DateTime?                      // Set when successfully claimed (one-time)
  createdAt    DateTime   @default(now())

  @@index([tokenHash])
}
```

### New Helpers

Following the reference app pattern, add to `src/lib/crypto.ts` (or a new file):

```typescript
import { randomBytes, createHash } from "crypto";

/** Generate a random base64url claim code (32 bytes → ~43 chars) */
export function generateClaimCode(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash (hex) */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
```

---

### New API Endpoints

All new endpoints follow the same handler pattern established in `botMe.ts`:

```typescript
// 1. CORS cache-busting headers (always first)
addCorsCacheBustingHeaders(res);
// 2. Rate limit with keySuffix for per-endpoint tracking
if (!applyRateLimit(req, res, { keySuffix: "v1/<endpointName>" })) return;
// — or applyStrictRateLimit for unauthenticated endpoints —
// 3. CORS preflight
await cors(req, res);
if (req.method === "OPTIONS") return res.status(200).end();
// 4. Method check
if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
```

Imports reused from existing modules:
- `cors`, `addCorsCacheBustingHeaders` from `@/lib/cors`
- `applyRateLimit`, `applyStrictRateLimit` from `@/lib/security/requestGuards`
- `verifyJwt` from `@/lib/verifyJwt` (for `botClaim` human JWT validation)
- `db` from `@/server/db`
- `generateClaimCode`, `sha256` from `@/lib/crypto`

| Endpoint | Method | Auth | Rate Limit | Purpose |
|----------|--------|------|------------|---------|
| `/api/v1/botRegister` | POST | None | `applyStrictRateLimit` keySuffix `"v1/botRegister"` | Bot self-registers, receives `pendingBotId` + claimCode |
| `/api/v1/botClaim` | POST | Human JWT | `applyRateLimit` keySuffix `"v1/botClaim"` | Human enters claimCode to claim the bot, optionally narrows scopes |
| `/api/v1/botPickupSecret` | GET | None (pendingBotId) | `applyStrictRateLimit` keySuffix `"v1/botPickupSecret"` | Bot polls with pendingBotId to collect its credentials (one-time) |

---

#### `POST /api/v1/botRegister`

**Request:**
```json
{
  "name": "My Governance Bot",
  "paymentAddress": "addr1q...",
  "stakeAddress": "stake1...",
  "requestedScopes": ["multisig:read", "ballot:write"]
}
```

**Response (201):**
```json
{
  "pendingBotId": "clxyz...",
  "claimCode": "dGhpcyBpcyBhIHJhbmRvbSBiYXNlNjR1cmw",
  "claimExpiresAt": "2026-03-04T12:10:00Z"
}
```

**What happens in the handler:**
1. Validate input (name, paymentAddress format, scopes are valid `BotScope` values)
2. Check paymentAddress not already registered to a claimed bot (reject 409)
3. `claimCode = generateClaimCode()` — random base64url string
4. In one transaction:
   - Create `PendingBot` with `status = UNCLAIMED`, `expiresAt = now + 10 min`
   - Create `BotClaimToken` with `tokenHash = sha256(claimCode)`, `expiresAt = now + 10 min`
5. Return `pendingBotId`, plain `claimCode` (shown only now), `claimExpiresAt`

**Security:**
- Rate limit: 5/min per IP (`applyStrictRateLimit`)
- Body size: 2 KB max
- Address validation (valid Cardano address)
- Duplicate paymentAddress check (only against claimed bots, not pending — avoids griefing)

**Errors:**
- `400 invalid_registration_payload` — validation failure
- `409 address_already_registered` — paymentAddress belongs to a claimed bot
- `429 registration_rate_limited` — rate limit exceeded

---

#### `POST /api/v1/botClaim`

**Request:**
```json
{
  "pendingBotId": "clxyz...",
  "claimCode": "dGhpcyBpcyBhIHJhbmRvbSBiYXNlNjR1cmw",
  "approvedScopes": ["multisig:read", "ballot:write"]
}
```

**Response (200):**
```json
{
  "botKeyId": "clbot...",
  "botId": "clbotuser...",
  "name": "My Governance Bot",
  "scopes": ["multisig:read", "ballot:write"]
}
```

**What happens in the handler:**
1. Verify human JWT from `Authorization` header
2. Validate input (`pendingBotId`, `claimCode` min length 24, optional `approvedScopes`)
3. Hash incoming code: `tokenHash = sha256(claimCode)`
4. In one transaction:
   - Load `PendingBot` by ID
   - Reject if not found (`bot_not_found`)
   - Reject if already claimed (`bot_already_claimed`)
   - Find unconsumed, unexpired `BotClaimToken` for this `pendingBotId`
   - If token `attempts >= 3`, reject (`claim_locked_out`)
   - If `tokenHash` doesn't match, increment `attempts`; reject (`invalid_or_expired_claim_code`)
   - Validate `approvedScopes` is subset of `requestedScopes`
   - Generate `secret` (32 bytes hex), create `BotKey` with `sha256hmac(secret)` as `keyHash`
   - Create `BotUser` with `paymentAddress` from `PendingBot`
   - Update `PendingBot`: `status = CLAIMED`, `claimedBy = jwt.address`, store encrypted secret in `secretCipher`
   - Mark claim token consumed (`consumedAt = now`)
5. Return `botKeyId`, `botId`, `name`, `scopes`

**Security:**
- Requires human JWT (authenticated user becomes `ownerAddress`)
- Claim code verified against hash (constant-time comparison)
- Max 3 attempts on the claim token → locks out
- `approvedScopes` must be subset of `requestedScopes`

**Errors:**
- `401 unauthorized` — missing or invalid JWT
- `400 invalid_claim_payload` — validation failure (including claimCode min length 24)
- `404 bot_not_found` — no PendingBot with that ID
- `409 bot_already_claimed` — already claimed by another user
- `409 invalid_or_expired_claim_code` — wrong code or expired
- `409 claim_locked_out` — too many failed attempts

---

#### `GET /api/v1/botPickupSecret`

**Request:**
```
GET /api/v1/botPickupSecret?pendingBotId=clxyz...
```

**Response (200) — one-time:**
```json
{
  "botKeyId": "clbot...",
  "secret": "a1b2c3...64_hex_chars",
  "paymentAddress": "addr1q..."
}
```

**What happens in the handler:**
1. Validate query param (`pendingBotId`)
2. Load `PendingBot` by ID
3. If not found → 404
4. If `status != CLAIMED` → 404 (not yet claimed, bot should keep polling)
5. If `pickedUp == true` → 410 (already collected)
6. In one transaction:
   - Decrypt `secretCipher` to get plain secret
   - Look up `BotKey` + `BotUser` created during claim
   - Mark `PendingBot.pickedUp = true`, clear `secretCipher`
7. Return `botKeyId`, plain `secret`, `paymentAddress`

**Security:**
- `pendingBotId` is a cuid (non-guessable) — acts as bearer credential
- Returns secret exactly once, then `pickedUp` flag prevents re-read
- `secretCipher` cleared from DB after pickup
- Rate limited via `applyStrictRateLimit`
- Expired `PendingBot` records cleaned up by housekeeping job

**Errors:**
- `400 invalid_pickup_payload` — missing pendingBotId
- `404 not_yet_claimed` — PendingBot exists but not claimed yet (bot should keep polling)
- `404 not_found` — no PendingBot with that ID
- `410 already_picked_up` — secret already collected

---

### Data Written During Claim Lifecycle

#### On registration
- Insert `PendingBot` (`status = UNCLAIMED`)
- Insert `BotClaimToken` (hashed claim code + 10 min expiry)

#### On successful claim
- Insert `BotKey` (with hashed secret, scopes, ownerAddress)
- Insert `BotUser` (with paymentAddress from PendingBot)
- Update `PendingBot`: `status = CLAIMED`, `claimedBy`, `secretCipher` (encrypted secret)
- Update `BotClaimToken.consumedAt` → `now`

#### On secret pickup
- Update `PendingBot`: `pickedUp = true`, clear `secretCipher`

This makes the claim code one-time and time-bounded, and the secret one-time collectible.

---

### UI Changes: Claim Flow in `BotManagementCard.tsx`

#### Layout Change: Two Action Buttons

Replace the single "Create bot" button area with two buttons side by side:

```
┌──────────────────────────────────────────────────┐
│ Bot accounts                                     │
│ Create and manage bots for API access            │
│                                                  │
│ Bots           [Claim a bot]  [Create bot ▾]     │
│                  (primary)      (outline/secondary)│
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Bot name                  [Edit] [🗑]    │    │
│  │ Key ID: clxyz...abc                      │    │
│  │ Scopes: multisig:read  ballot:write      │    │
│  │ Bot address: addr1q...xyz                │    │
│  │ Created 3/4/2026                         │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

- **"Claim a bot"** — primary action, opens the new claim dialog
- **"Create bot"** — existing flow, demoted to `variant="outline"` with smaller visual weight
  - Tooltip or small label: "Advanced — for manually provisioned bots"

#### New State Variables

```typescript
// Claim dialog state
const [claimOpen, setClaimOpen] = useState(false);
const [claimStep, setClaimStep] = useState<"enterCode" | "review" | "success">("enterCode");
const [pendingBotId, setPendingBotId] = useState("");
const [claimCode, setClaimCode] = useState("");
const [pendingBotInfo, setPendingBotInfo] = useState<{
  name: string;
  paymentAddress: string;
  requestedScopes: BotScope[];
} | null>(null);
const [approvedScopes, setApprovedScopes] = useState<BotScope[]>([]);
const [claimResult, setClaimResult] = useState<{
  botKeyId: string;
  botId: string;
  name: string;
  scopes: BotScope[];
} | null>(null);
```

#### New tRPC Procedures (bot router additions)

Add to `src/server/api/routers/bot.ts`:

```typescript
// Fetch pending bot info for display during claim
lookupPendingBot: protectedProcedure
  .input(z.object({ pendingBotId: z.string().min(1) }))
  .query(/* returns { name, paymentAddress, requestedScopes, status } or 404 */),

// Claim a pending bot (calls POST /api/v1/botClaim internally or directly via Prisma)
claimBot: protectedProcedure
  .input(z.object({
    pendingBotId: z.string().min(1),
    claimCode: z.string().min(24),
    approvedScopes: z.array(z.enum(BOT_SCOPES)),
  }))
  .mutation(/* performs claim logic, returns { botKeyId, botId, name, scopes } */),
```

#### Claim Dialog: 3-Step Flow

Uses the same `Dialog` + conditional rendering pattern as the existing create dialog (not a separate component). Steps managed by `claimStep` state.

**Step 1 — "Enter claim details"**

```
┌─────────────────────────────────────────┐
│  🔗 Claim a bot                         │
│  Enter the bot ID and claim code from   │
│  your bot's output.                     │
│                                         │
│  Bot ID                                 │
│  ┌─────────────────────────────────┐    │
│  │ clxyz...                        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Claim code                             │
│  ┌─────────────────────────────────┐    │
│  │ paste from bot output           │    │
│  └─────────────────────────────────┘    │
│                                         │
│                          [Cancel] [Next]│
└─────────────────────────────────────────┘
```

- On "Next": call `lookupPendingBot` query with `pendingBotId`
  - If found + UNCLAIMED → populate `pendingBotInfo`, pre-check all `requestedScopes` in `approvedScopes`, advance to step 2
  - If not found / expired / already claimed → show inline error, stay on step 1

**Step 2 — "Review & approve scopes"**

```
┌─────────────────────────────────────────┐
│  🔗 Claim a bot                         │
│  Review the bot's details and approve   │
│  its requested permissions.             │
│                                         │
│  Bot name        My Governance Bot      │
│  Address         addr1q...xyz           │
│                                         │
│  Requested scopes                       │
│  ☑ multisig:read                        │
│  ☑ ballot:write                         │
│  ☐ multisig:sign    (unchecked = narrow)│
│                                         │
│  ⚠ Warning: without multisig:read...   │
│                                         │
│                     [Back] [Claim bot]  │
└─────────────────────────────────────────┘
```

- Shows bot name + truncated address (via `getFirstAndLast`)
- Scope checkboxes pre-checked with `requestedScopes`, user can uncheck to narrow
- Same `missingReadScope` warning pattern as existing create/edit dialogs
- Uses existing `BOT_SCOPES` list but only shows scopes the bot requested (greyed-out unchecked for non-requested scopes)
- "Back" returns to step 1 (preserves entered values)
- "Claim bot" calls `claimBot` mutation

**Step 3 — "Success"**

```
┌─────────────────────────────────────────┐
│  ✓ Bot claimed successfully             │
│                                         │
│  "My Governance Bot" is now linked to   │
│  your account. The bot will              │
│  automatically pick up its credentials. │
│                                         │
│  Bot ID    clbotuser...                 │
│  Key ID    clbot...                     │
│  Scopes    multisig:read  ballot:write  │
│                                         │
│                                 [Done]  │
└─────────────────────────────────────────┘
```

- On success: invalidate `utils.bot.listBotKeys` (bot appears in list immediately)
- "Done" closes dialog and resets all claim state

#### Mutation Wiring

```typescript
const claimBot = api.bot.claimBot.useMutation({
  onSuccess: (data) => {
    setClaimResult(data);
    setClaimStep("success");
    void utils.bot.listBotKeys.invalidate();
    toast({
      title: "Bot claimed",
      description: `${data.name} is now linked to your account.`,
    });
  },
  onError: (err) => {
    // Map known error codes to user-friendly messages
    const messages: Record<string, string> = {
      bot_not_found: "Bot not found or registration expired.",
      bot_already_claimed: "This bot has already been claimed.",
      invalid_or_expired_claim_code: "Invalid or expired claim code.",
      claim_locked_out: "Too many failed attempts. Ask the bot to re-register.",
    };
    toast({
      title: "Claim failed",
      description: messages[err.message] ?? err.message,
      variant: "destructive",
    });
  },
});
```

#### Reset Helper

```typescript
const handleCloseClaim = () => {
  setClaimOpen(false);
  setClaimStep("enterCode");
  setPendingBotId("");
  setClaimCode("");
  setPendingBotInfo(null);
  setApprovedScopes([]);
  setClaimResult(null);
};
```

---

### Migration Path

- Keep existing `POST /api/v1/botAuth` and manual bot key creation as-is
- New flow is **additive** — no breaking changes
- Demote old "Create bot key" button to `variant="outline"` (secondary) in the UI
- Default onboarding docs point to new self-registration flow

---

### Cleanup & Housekeeping

- Cron/scheduled job to delete expired `PendingBot` records (> 10 min old, unclaimed)
- Delete consumed `BotClaimToken` records older than 1 hour
- Clear `secretCipher` on claimed-but-not-picked-up PendingBots older than 15 min
- Log failed claim attempts for abuse monitoring

---

## Implementation Tasklist

Work through these tasks in order. Each task is self-contained and results in a working, testable increment.

---

### Task 1: Prisma Schema — Add `PendingBot` and `BotClaimToken` models

**Files to change:**
- `prisma/schema.prisma`

**What to do:**
- Add the `PendingBotStatus` enum (`UNCLAIMED`, `CLAIMED`)
- Add the `PendingBot` model (all fields from the plan)
- Add the `BotClaimToken` model (all fields from the plan)
- Run `npx prisma migrate dev` to generate migration
- Run `npx prisma generate` to update the client

**Done when:** Migration applies cleanly and `npx prisma studio` shows the new tables.

---

### Task 2: Crypto helpers — `generateClaimCode()` and `sha256()`

**Files to change:**
- `src/lib/auth/botKey.ts` (add to existing file, no new file needed)

**What to do:**
- Add `generateClaimCode()` — `randomBytes(32).toString("base64url")`
- Add `sha256()` — `createHash("sha256").update(input).digest("hex")`
- Export both from the module

**Done when:** Functions are exported and the existing `botKey.ts` imports still work.

---

### Task 3: API endpoint — `POST /api/v1/botRegister`

**Files to create:**
- `src/pages/api/v1/botRegister.ts`

**What to do:**
- Follow the handler pattern from `botAuth.ts` / `botMe.ts`
- Unauthenticated endpoint with `applyStrictRateLimit` (keySuffix `"v1/botRegister"`)
- Validate body: `name` (string, 1–100 chars), `paymentAddress` (non-empty string), optional `stakeAddress`, `requestedScopes` (array of valid `BotScope` values)
- Check `paymentAddress` not already on a **claimed** `PendingBot` or existing `BotUser`
- Generate claim code, create `PendingBot` + `BotClaimToken` in a transaction
- Return `{ pendingBotId, claimCode, claimExpiresAt }`
- Enforce 2 KB body size via `enforceBodySize`

**Done when:** `curl POST /api/v1/botRegister` returns a `pendingBotId` + `claimCode` and rows appear in DB.

---

### Task 4: API endpoint — `POST /api/v1/botClaim`

**Files to create:**
- `src/pages/api/v1/botClaim.ts`

**What to do:**
- Human JWT required (`verifyJwt` + ensure NOT a bot JWT)
- `applyRateLimit` with keySuffix `"v1/botClaim"`
- Validate body: `pendingBotId`, `claimCode` (min 24 chars), optional `approvedScopes`
- Hash incoming code, load `PendingBot` + `BotClaimToken` in transaction
- All rejection logic: not found, already claimed, expired, locked out (≥3 attempts), hash mismatch (increment attempts)
- On match: generate secret via `generateBotKeySecret()`, hash via `hashBotKeySecret()`, create `BotKey` + `BotUser`, update `PendingBot` status to `CLAIMED`, store encrypted secret in `secretCipher`, mark token consumed
- `approvedScopes` must be subset of `requestedScopes`
- Return `{ botKeyId, botId, name, scopes }`

**Done when:** Full register → claim flow works end-to-end via curl. `BotKey` and `BotUser` rows created.

---

### Task 5: API endpoint — `GET /api/v1/botPickupSecret`

**Files to create:**
- `src/pages/api/v1/botPickupSecret.ts`

**What to do:**
- Unauthenticated (pendingBotId as bearer credential in query param)
- `applyStrictRateLimit` with keySuffix `"v1/botPickupSecret"`
- Load `PendingBot` by `pendingBotId`
- 404 if not found or not yet claimed
- 410 if `pickedUp == true`
- Return `{ botKeyId, secret, paymentAddress }`, then mark `pickedUp = true` and clear `secretCipher`

**Done when:** Full register → claim → pickup flow works. Secret returned once, second call returns 410.

---

### Task 6: tRPC procedures — `lookupPendingBot` and `claimBot`

**Files to change:**
- `src/server/api/routers/bot.ts`

**What to do:**
- Add `lookupPendingBot` — `protectedProcedure` query, input `{ pendingBotId }`, returns `{ name, paymentAddress, requestedScopes, status }` or throws 404
- Add `claimBot` — `protectedProcedure` mutation, input `{ pendingBotId, claimCode, approvedScopes }`, performs the same claim logic as the `/api/v1/botClaim` endpoint (reuse or call shared helper). Returns `{ botKeyId, botId, name, scopes }`
- Consider extracting shared claim logic into a helper function used by both the API endpoint and the tRPC procedure

**Done when:** Both procedures callable from the frontend via tRPC.

---

### Task 7: UI — Add "Claim a bot" button and claim dialog to `BotManagementCard`

**Files to change:**
- `src/components/pages/user/BotManagementCard.tsx`

**What to do:**
- Add new state variables for claim dialog (`claimOpen`, `claimStep`, `pendingBotId`, `claimCode`, `pendingBotInfo`, `approvedScopes`, `claimResult`)
- Add "Claim a bot" button (primary) next to existing "Create bot" button (demote to `variant="outline"`)
- Implement 3-step claim dialog:
  - **Step 1:** Enter `pendingBotId` + `claimCode`, "Next" calls `lookupPendingBot`
  - **Step 2:** Review bot info + scope checkboxes (pre-checked with requested scopes, user can uncheck to narrow), "Claim bot" calls `claimBot` mutation
  - **Step 3:** Success confirmation showing `botKeyId`, `botId`, scopes
- Wire up `claimBot` mutation with `onSuccess` (invalidate `listBotKeys`, toast) and `onError` (map error codes to messages)
- Add `handleCloseClaim` reset helper

**Done when:** Full claim flow works in the UI. Bot appears in list after claiming.

---

### Task 8: Cleanup job — Expire stale `PendingBot` records

**Files to create/change:**
- New API route or utility for cleanup (e.g., `src/pages/api/cron/cleanupPendingBots.ts` or add to existing cron infrastructure)

**What to do:**
- Delete expired unclaimed `PendingBot` records (> 10 min old, status `UNCLAIMED`)
- Delete consumed `BotClaimToken` records older than 1 hour
- Clear `secretCipher` on claimed-but-not-picked-up `PendingBot` records older than 15 min
- Protect endpoint with a cron secret or internal-only access

**Done when:** Stale records are cleaned up on schedule. No secrets linger in the database.

---

### Task 9: Testing and hardening

**What to do:**
- Test the full happy path: register → claim → pickup → botAuth
- Test error paths: expired claim, wrong code, locked out after 3 attempts, duplicate address, already claimed, already picked up
- Verify rate limits fire correctly on all three new endpoints
- Verify constant-time comparison on claim code hash
- Confirm `secretCipher` is cleared after pickup
- Confirm expired records are cleaned up

**Done when:** All paths tested, no secrets leak, rate limits enforced.

---
