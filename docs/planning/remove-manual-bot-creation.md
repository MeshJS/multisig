# Remove Manual Bot Creation — Claim-Only Flow

## Goal

Remove the old "Create bot" flow where a human manually creates a bot key from the UI and copies a secret JSON blob. Only the new claim flow (bot self-registers, human claims) should remain.

---

## Files to Update

### 1. `src/components/pages/user/BotManagementCard.tsx`

**What to remove:**
- State variables for old create dialog: `createOpen`, `newName`, `newScopes`, `createdSecret`, `createdBotKeyId` (lines 30–34)
- `handleCloseCreate` function (lines 62–68)
- `createBotKey` mutation hook and its `onSuccess`/`onError` (lines 87–105)
- `handleCreate` function (lines 203–213)
- `toggleScope` function for create scopes (lines 226–230)
- `missingReadScopeInCreate` derived value (line 238)
- The entire "Create bot" `<Dialog>` + `<DialogTrigger>` button and its dialog content (lines 260–356) — this includes the secret display, JSON blob copy, and manual instructions

**What to update:**
- "Claim a bot" button should become the only action button — promote it or adjust layout now that "Create bot" is gone
- The empty state message (line 579): `"No bots yet. Create one to allow API access..."` → update wording to reference the claim flow instead

---

### 2. `src/server/api/routers/bot.ts`

**What to remove:**
- `createBotKey` procedure (lines ~16–39) — the tRPC mutation that generates a secret and creates a `BotKey` directly

**What to keep:**
- `listBotKeys`, `updateBotKeyScopes`, `revokeBotKey` — still needed for managing claimed bots
- `grantBotAccess`, `revokeBotAccess`, `listWalletBotAccess` — still needed
- `lookupPendingBot`, `claimBot` — the new flow

---

### 3. `src/lib/auth/botKey.ts`

**What to review:**
- `generateBotKeySecret()` and `hashBotKeySecret()` — these are still used by `claimBot.ts` (the claim handler generates a secret during the claim step). **Keep them.**
- `verifyBotKeySecret()` — still used by `botAuth.ts` for ongoing bot authentication. **Keep.**
- `generateClaimCode()`, `sha256()` — new flow helpers. **Keep.**
- `BOT_SCOPES`, `parseScope`, `scopeIncludes` — used everywhere. **Keep.**

**Net result:** No changes needed in this file.

---

### 4. `scripts/bot-ref/README.md`

**What to update:**
- Config section (lines 7–20): Remove references to "Create bot UI" and "copy the JSON blob". Replace with instructions for the new self-registration + claim + pickup flow.
- "Register / get token" section (lines 39–50): Update to describe the new flow:
  1. Bot calls `POST /api/v1/botRegister` → gets `pendingBotId` + `claimCode`
  2. Human enters claim code in the UI
  3. Bot calls `GET /api/v1/botPickupSecret?pendingBotId=...` → gets `botKeyId` + `secret`
  4. Bot calls `POST /api/v1/botAuth` with the received credentials
- "Cursor agent testing" section (lines 116–127): Update step 1 from "Create a bot in the app" to the new claim flow

---

### 5. `scripts/bot-ref/bot-client.ts`

**What to update:**
- Add new commands for the self-registration flow:
  - `register` — calls `POST /api/v1/botRegister` with name, paymentAddress, scopes
  - `pickup` — calls `GET /api/v1/botPickupSecret?pendingBotId=...`
- The existing `auth` command stays (it's used after pickup to get a JWT)
- Update help text / usage instructions

---

### 6. `scripts/bot-ref/bot-config.sample.json`

**What to update:**
- Current format assumes the human has a `botKeyId` + `secret` from the old create flow
- Add a comment or alternate sample showing the new flow where `botKeyId` and `secret` come from the pickup endpoint
- Could add a `pendingBotId` field for the registration → pickup phase

---

### 7. `src/pages/api/v1/README.md`

**What to update:**
- `botAuth.ts` section (lines 267–283): Add a note that `botKeyId` + `secret` now come from the claim+pickup flow, not manual creation
- Add documentation entries for the three new endpoints:
  - `POST /api/v1/botRegister`
  - `POST /api/v1/botClaim`
  - `GET /api/v1/botPickupSecret`
- Remove any language implying manual bot key creation

---

### 8. `.env.example`

**What to review:**
- Check if any new env vars are needed for the claim flow (e.g., `PENDING_BOT_ENCRYPTION_KEY` for `secretCipher` encryption)
- Already modified per git status — verify it has the right additions

---

## Files That Stay Unchanged

| File | Reason |
|------|--------|
| `src/pages/api/v1/botAuth.ts` | Still the entry point for bot JWT auth — used by both old and new bots |
| `src/pages/api/v1/botRegister.ts` | New flow endpoint — already correct |
| `src/pages/api/v1/botClaim.ts` | New flow endpoint — already correct |
| `src/pages/api/v1/botPickupSecret.ts` | New flow endpoint — already correct |
| `src/lib/auth/claimBot.ts` | Shared claim logic — already correct |
| `src/pages/api/cron/cleanupPendingBots.ts` | Cleanup job — already correct |
| `.github/workflows/cleanup-pending-bots.yml` | Cron workflow — already correct |
| `prisma/schema.prisma` | Both `BotKey` (used post-claim) and `PendingBot` models needed |

---

## Migration Notes

- **Existing bot keys** created via the old flow will continue to work — `BotKey` table and `botAuth` endpoint are untouched. We're only removing the ability to create new ones manually.
- **No database migration needed** — this is purely a UI + API route removal.
- The `createBotKey` tRPC procedure is the only server-side code being deleted. All other bot infrastructure remains.

---

## Task Order

1. Remove `createBotKey` tRPC procedure from `bot.ts`
2. Remove old create dialog and related state/handlers from `BotManagementCard.tsx`
3. Update `scripts/bot-ref/README.md` with new flow instructions
4. Add `register` and `pickup` commands to `scripts/bot-ref/bot-client.ts`
5. Update `scripts/bot-ref/bot-config.sample.json`
6. Update `src/pages/api/v1/README.md` with new endpoint docs
7. Verify `.env.example` has all needed vars
