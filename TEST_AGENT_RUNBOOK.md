# Test Agent Runbook (Treasury Withdrawal)

This document explains how the test agent, offchain contract code, and UI
monitoring fit together. It also captures the most common failure modes and
how to debug them.

## Purpose
- Provide a single source of truth for running treasury-withdrawal tests.
- Reduce errors caused by mismatched governance actions or missing tokens.
- Standardize debugging steps and recovery actions.

## Quickstart
1. Start dev server:
   - `npm run dev`
2. Start a treasury run:
   - `curl -X POST http://localhost:3000/api/dev/agent/start -H "Content-Type: application/json" -d '{...}'`
3. Supervise:
   - `curl "http://localhost:3000/api/dev/agent/supervise?runId=<RUN_ID>&eventLimit=200"`
4. Cancel or resume:
   - `curl -X POST http://localhost:3000/api/dev/agent/supervise -H "Content-Type: application/json" -d '{"runId":"<RUN_ID>","action":"cancel"}'`
   - `curl -X POST http://localhost:3000/api/dev/agent/supervise -H "Content-Type: application/json" -d '{"runId":"<RUN_ID>","action":"resume"}'`

## How The Flow Works (Treasury Withdrawals)
Order of operations (treasury flow):
1. Initialize wallet
2. Faucet funds (optional; may be zero if wallet already funded)
3. Setup collateral
4. Withdraw previous crowdfunds (using their original governance config)
5. Setup new crowdfund
6. Contribute → withdraw → contribute (to hit the target)
7. Stake ref script
8. Register certs (includes proposal)
9. Stop at `waiting` until manual resume

Key detail: changing governance parameters or recompiling the contract changes
the script hash/address. Always withdraw old crowdfunds before changing params.

## Governance Action Alignment (Critical Invariant)
The validator checks that the governance action bytes used in parametrization
match the proposal in the transaction. If they differ, `proposal_check` fails.

Alignment rules:
- Treasury withdrawals must be **reward addresses only** (`stake1`/`stake_test1`).
- Withdrawals are **sorted** by address before encoding.
- Guardrails policy hash must be 28 bytes (56 hex).
- Legacy 32-byte hashes (64 hex) must be preserved only for *old* withdrawals.

## Guardrails Script Hash
Cardano script hashes are blake2b-224 (28 bytes).

Example:
- `b2sum -l 224 guardrails-script.plutus | cut -d' ' -f1`

Use the 56-hex result as `NEXT_PUBLIC_GUARDRAILS_POLICY_HASH`.
Legacy 64-hex hashes are only for old records and should not be used for new
parametrization.

## Share Tokens And Withdrawals
Withdrawing a crowdfund requires burning share tokens. The wallet that submits
the withdraw must hold those tokens.

Symptoms:
- `Insufficient share tokens to burn. Required: ..., available: 0`

Fix:
- Ensure the agent wallet holds share tokens for the policy in `datum.share_token`.
- If the agent wallet doesn’t have the tokens, you must transfer them or skip
  withdrawing that crowdfund.

Quick check for wallet assets (KoiosProvider):
```
node --input-type=module <<'NODE'
import { KoiosProvider } from '@meshsdk/core';
const addr = '<WALLET_ADDR>';
const p = new KoiosProvider('sancho');
const utxos = await p.fetchAddressUTxOs(addr);
const assets = new Map();
for (const u of utxos) {
  for (const a of u.output.amount ?? []) {
    if (a.unit && a.unit !== 'lovelace') {
      assets.set(a.unit, (assets.get(a.unit) ?? 0n) + BigInt(a.quantity ?? '0'));
    }
  }
}
console.log([...assets.entries()]);
NODE
```

## Koios / Confirmation Debugging
Koios `tx_info` can lag behind UTxO presence. Cross-check with address UTxOs.

Commands:
- `POST /api/koios/tx_info`
- `POST /api/koios/tx_status`
- `POST /api/koios/address_utxos`

If `tx_info` is empty but the tx appears in `address_utxos`, the tx is confirmed.

## UI Monitoring
The Test Agent Panel polls `/api/dev/agent/supervise` and shows:
- Run state, last event, last error
- Available actions (resume/cancel)
- Event log (should auto-scroll to the latest event)

## Refinement Log
Use the command below after each debugging session to append a template entry.
- `npm run docs:refine`

## Refinement Log Entries

