# Ekklesia / Intersect Hydra Voting — reverse-engineered API spec

Source: live API at `https://intersect.ekklesia.vote/api` + the SvelteKit frontend bundle
(`/_app/immutable/...`). The published docs at `docs.ekklesia.vote` are JS-rendered and
could not be fetched as text; this spec was confirmed against real responses and the
shipped client code (June 2026). API stability is not guaranteed across instances — pin and
re-verify before relying on it.

Base URL: `https://intersect.ekklesia.vote/api`  (versioned calls use the `/v1` prefix → `/api/v1/...`)

Transport: all requests send `Content-Type: application/json`, `credentials: include`
(cookie), and `Authorization: Bearer <jwt>` when a token is held. A `401` means the token
expired → re-auth.

## The 2026 Budget ballot

- `GET /api/v1/ballots` → list. The budget ballot id is **`6a1512d782978c99456fe6de`**
  (`source: "hydra"`, `voterType: "drep"`, `voteWeighted: true`,
  window `2026-05-26 → 2026-06-12T12:00:00Z`).
- `GET /api/v1/ballots/:id` → full ballot. The votable content is under
  `data.hydra.ballot`:
  - `questions[]` (69 proposals): each `{ questionId, question (title), description,
    method: "binary", options: [{label:"Yes",value:1},{label:"No",value:2}],
    minSelections, maxSelections, requireAnswer, contentHash }`.
  - `ekklesia`: `{ namespace, votingAuthority, context: "hydra-head",
    acceptedCredentials: ["drep"], merkleRoot (ballot-definition root),
    votingWindow:{open,close} }`.

## Auth flow (per signer) — CIP-8 → JWT

1. `POST /api/v1/session` `{ signerAddress, signType }` (signType `"drep"` for us) → returns
   a challenge containing `dataHex` (the nonce to sign) plus identity echoes
   (`userId`, `userIdHex` for drep, `signerAddressHex`, `merkleRoot`).
2. Sign `dataHex` with CIP-8: `(api.cip95 ?? api).signData(address, dataHex)` →
   Mesh `DataSignature` `{ signature, key }` (COSE_Sign1 hex + COSE_Key hex).
3. `PUT /api/v1/session` `{ signerAddress, signType, signature, key }` → sets JWT
   (cookie + bearer).
- `GET /api/v1/session/` → current voter; `DELETE /api/v1/session` → logout.

## Vote flow

`merkleRoot → hex` helper used before signing (sign the merkleRoot **string** as its ASCII bytes):
```js
const toDataHex = (s) => { let h=""; for (let i=0;i<s.length;i++) h+=s.charCodeAt(i).toString(16).padStart(2,"0"); return h; };
```

Vote item shape (per question):
```js
// Yes → selection [1], No → selection [2]; abstain → {abstain:true}
{ questionId, selection: [1] }   |   { questionId, abstain: true }
```

1. **Draft** `POST /api/v1/votes/:ballotId/draft`
   body: `{ votes: VoteItem[], nativeScript?: <script>, calidusDeclaration?: {...} }`
   - **Multisig DRep**: include `nativeScript` (the DRep native script) so the server can
     parse the required-signer set / threshold (`sig`/`all`/`any`/`atLeast`).
   - Response `d`: `{ merkleRoot, multisig, nonce, status, id|_id, package:{id|_id,...} }`.
     `packageId = d.package.id ?? d.package._id ?? d.id`.
2. **Sign** `dataHex = toDataHex(d.merkleRoot)`; `(api.cip95 ?? api).signData(drepAddress, dataHex)`
   → `{ signature, key }`.
3. **Submit signature** `POST /api/v1/votes/:ballotId/signature`
   body: `{ packageId, witness: { signature, key } }`  (server also accepts
   `{ COSE_Sign1_hex, COSE_Key_hex }`). Each multisig cosigner calls this with the **same**
   `packageId` (one shared draft / merkleRoot — do NOT redraft per signer; each draft has its
   own nonce → different merkleRoot → non-aggregatable).
4. **Submit package** `POST /api/v1/votes/:ballotId/submit` `{ packageId }` once the native
   script threshold of witnesses is met (single-sig may auto-submit after the signature step;
   multisig submits/aggregates when complete). The broker pushes to the Hydra head.

## Read / manage

- `GET /api/v1/votes/:ballotId/mine` → my current votes.
- `GET /api/v1/votes/:ballotId/packages?includeTerminal&limit` → my draft/vote packages
  (status incl. `awaiting-signatures`).
- `DELETE /api/v1/votes/:ballotId/package/:packageId` → cancel a draft, release its nonce.

## Mapping to this app

- `signData` `{signature,key}` == Mesh `DataSignature` returned by `sign()` in
  `src/utils/signing.ts` (role 3 = DRep). Use it verbatim as both the auth signature and the
  vote witness.
- DRep address/credential: `multisigWallet.getDRepId()` (CIP-129) / `getDRepId105()`;
  native script for the draft: `multisigWallet.getDRepScript()` /
  `getNativeScript()`-equivalent.
- Multi-signer coordination maps onto the existing **signable** subsystem
  (`src/server/api/routers/signable.ts`): store `{ ballotId, packageId, merkleRoot, votes }`
  as the signable payload; each signer appends their `{signature,key}` and POSTs it to
  `/signature`; complete at threshold.
