/**
 * Roadmap content, kept apart from the view so the page stays declarative and
 * the plan can be edited without touching layout code.
 *
 * The source of record is ROADMAP.md at the repo root — when a month lands or
 * slips, update both. `status` here reflects the `preprod` branch, which is not
 * the same as what is live in production (see RELEASE_GAP).
 */

/** Twelve months of the plan, left to right. `index` is the grid column offset. */
export const MONTHS = [
  { short: "May", year: "2026" },
  { short: "Jun", year: "2026" },
  { short: "Jul", year: "2026" },
  { short: "Aug", year: "2026" },
  { short: "Sep", year: "2026" },
  { short: "Oct", year: "2026" },
  { short: "Nov", year: "2026" },
  { short: "Dec", year: "2026" },
  { short: "Jan", year: "2027" },
  { short: "Feb", year: "2027" },
  { short: "Mar", year: "2027" },
  { short: "Apr", year: "2027" },
] as const;

/** 1-based month number the plan has reached; the "today" rule sits at its right edge. */
export const CURRENT_MONTH = 3; // July 2026

export type Status = "done" | "risk" | "planned";

export type RoadmapItem = {
  label: string;
  /** 1-based month the bar starts in. */
  start: number;
  /** Number of months the bar covers. */
  span: number;
  status: Status;
  /** "Q", "A", or "Q·A". Omitted where the month carries no single owner. */
  owner?: string;
  detail: string;
};

export type Track = {
  name: string;
  sub: string;
  items: RoadmapItem[];
};

export const TRACKS: Track[] = [
  {
    name: "Release & production health",
    sub: "Blocking",
    items: [
      {
        label: "Gap opens",
        start: 3,
        span: 1,
        status: "risk",
        detail:
          "Production stuck at the 2026-05-10 migration. The 17 June deploy run failed, and the path-filtered workflow never re-fired.",
      },
      {
        label: "Release",
        start: 4,
        span: 1,
        status: "risk",
        owner: "Q",
        detail:
          "August, first task: merge preprod into main, dispatch Deploy Database Migrations, confirm all four apply. Closes the RLS exposure and un-breaks governance tallies.",
      },
      {
        label: "Drift gate",
        start: 5,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "A post-deploy prisma migrate status gate with drift alerting, so merged and applied cannot silently diverge again.",
      },
    ],
  },
  {
    name: "Document Sign-Off",
    sub: "Flagship",
    items: [
      {
        label: "MVP — build & ship",
        start: 4,
        span: 2,
        status: "planned",
        owner: "Q·A",
        detail:
          "Finalize PRD-001 (still Draft), then a five-model schema, tRPC routes, CIP-8 enforcement, version-hash binding, Documents UI, six-state lifecycle and proof export. Ready = a pilot team runs all six user stories unaided.",
      },
      {
        label: "v1 history",
        start: 6,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "v1: revision history first-class, diff and rollback, richer audit export. Still off-chain.",
      },
      {
        label: "v2 anchor",
        start: 9,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "v2 Checkpoints: opt-in on-chain anchoring of a version hash plus its parent in Cardano transaction metadata.",
      },
      {
        label: "v3 research",
        start: 11,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "v3 Collaboration and standards: CRDT co-authoring, a CIP candidate, an eIDAS/EUDI QES bridge. Scoped as research.",
      },
    ],
  },
  {
    name: "Governance",
    sub: "DReps · voting",
    items: [
      {
        label: "Voting",
        start: 2,
        span: 1,
        status: "done",
        owner: "Q",
        detail:
          "In-app voting for multisig DReps: Ekklesia/Hydra budget voting, DRep-registration detection, ballot UX, DB-cached tallies. Closed #122 five months early.",
      },
      {
        label: "DRep explorer",
        start: 3,
        span: 1,
        status: "done",
        owner: "Q",
        detail:
          "Public DRep vote-history explorer, no wallet required. CIP-100/136 rationales resolved from IPFS, nine-column CSV export, served through a Koios proxy.",
      },
      {
        label: "Proxy",
        start: 8,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "Proxy voting polish and documentation, plus the collateral service for proxy usage (#221) — the last backlog item without a slot.",
      },
    ],
  },
  {
    name: "Bot & agent platform",
    sub: "Early · M7 freed",
    items: [
      {
        label: "Bot platform",
        start: 3,
        span: 1,
        status: "done",
        owner: "Q",
        detail:
          "Arrived about four months early. Human-in-the-loop onboarding, five scopes plus per-wallet grants, 27 bot-accessible endpoints, rate limiting and ballot drafting. A bot still cannot move funds alone.",
      },
      {
        label: "Webhooks",
        start: 7,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "All that remains of Bot platform v2 is webhooks — no webhook code exists yet. Plus a multisig MCP server, so an agent can act as observer or ballot drafter.",
      },
    ],
  },
  {
    name: "Wallets & discovery",
    sub: "Wallet V2 · devices",
    items: [
      {
        label: "Legacy",
        start: 1,
        span: 1,
        status: "done",
        owner: "Q",
        detail:
          "Legacy wallet compatibility fixed — DRep retirement and deregistration (#210, #225); issue #223 closed.",
      },
      {
        label: "Wallet V2",
        start: 3,
        span: 1,
        status: "done",
        owner: "A",
        detail:
          "On-chain wallet registration and discovery shipped in #340, on schedule.",
      },
      {
        label: "Discover",
        start: 5,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "The Discover page moved up from M10 to ride the delivered Wallet V2 discovery work — plus lookup by signer and policy.",
      },
      {
        label: "Hardware",
        start: 6,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "Ledger and Trezor. Their CIP-8 signData support is limited and Sign-Off approvals depend on it — scope that constraint during the Aug–Sep build, not after.",
      },
      {
        label: "Invites",
        start: 10,
        span: 1,
        status: "planned",
        owner: "Q",
        detail: "Invite flow (PR #67).",
      },
    ],
  },
  {
    name: "Reliability & CI",
    sub: "Tests · pipeline",
    items: [
      {
        label: "Smoke CI & preprod",
        start: 1,
        span: 2,
        status: "done",
        owner: "A",
        detail:
          "Preprod environment, real-chain smoke system (#213 closed), deploy-migrations on Node 22, pg pool cap, dependency hardening.",
      },
      {
        label: "E2E suite",
        start: 3,
        span: 1,
        status: "done",
        owner: "A",
        detail:
          "Playwright E2E: 11 spec files, about 54 tests — wallet creation, real preprod ring transfers, staking, proxy, DRep and ballot UI, bot management, access control. Runs in Docker.",
      },
      {
        label: "Unblock CI",
        start: 4,
        span: 1,
        status: "risk",
        owner: "A",
        detail:
          "pr-multisig-v1-smoke.yml hard-fails when secrets are absent, and dependabot runs never receive them — so all seven open dependency PRs are red for systemic reasons. ci-smoke-preprod.yml already has the guard to copy.",
      },
      {
        label: "Test depth",
        start: 5,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "Extend Playwright to the Sign-Off flows; transaction-builder and tRPC integration tests (#255).",
      },
    ],
  },
  {
    name: "Notifications",
    sub: "Email · outbox",
    items: [
      {
        label: "Notification center",
        start: 2,
        span: 2,
        status: "done",
        owner: "A",
        detail:
          "Resend-backed email with a real outbox: idempotency keys, retry backoff, nine delivery statuses, per-wallet and per-signer settings, hashed-token verification.",
      },
      {
        label: "Drain",
        start: 4,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "#327 follow-ups, Playwright coverage, and a scheduled drain — no cron currently runs drainNotificationOutbox.",
      },
      {
        label: "Digests",
        start: 5,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "Ballot-deadline and threshold-reached reminders on the existing outbox — product work, since the infrastructure already exists.",
      },
    ],
  },
  {
    name: "Platform & UX",
    sub: "Mesh 2.0 · interface",
    items: [
      {
        label: "UX base",
        start: 2,
        span: 1,
        status: "done",
        owner: "Q",
        detail:
          "Signing and auth reliability, mobile foundations, skeleton and empty states, error toasts, pagination, landing, SEO and the glass theme.",
      },
      {
        label: "Mesh 2.0 — awaiting upstream 2.x",
        start: 3,
        span: 3,
        status: "risk",
        owner: "Q",
        detail:
          "Blocked upstream — npm latest for @meshsdk/core is still 1.9.1; no 2.x exists. Our side is ready. Demoted from a monthly task to a standing watch item.",
      },
      {
        label: "Papercuts",
        start: 6,
        span: 1,
        status: "planned",
        owner: "A",
        detail:
          "UX papercut batch: full-address verification (#196), transaction pagination (#30), a better 404 page (#22).",
      },
      {
        label: "dApp link",
        start: 7,
        span: 1,
        status: "planned",
        owner: "Q",
        detail:
          "dApp connector — external dApps request multi-sig transactions — paired with improved authentication (#135), since they are the same problem surface.",
      },
      {
        label: "Audit",
        start: 11,
        span: 1,
        status: "planned",
        owner: "Q",
        detail: "Performance and UX audit, plus the final summary report.",
      },
    ],
  },
  {
    name: "Research",
    sub: "FROST · PQC",
    items: [
      {
        label: "FROST & PQC — kickoff to go/no-go",
        start: 4,
        span: 3,
        status: "planned",
        owner: "Q",
        detail:
          "FROST threshold Schnorr for Cardano (#220), plus Lemour post-quantum multi-sig. Kickoff slipped from July — starting in August keeps runway for the October go/no-go. Deliverables: a trade-off note, a PoC if libraries allow, and a recommendation.",
      },
    ],
  },
  {
    name: "Growth & accounts",
    sub: "Profiles · vesting",
    items: [
      {
        label: "Vesting",
        start: 9,
        span: 1,
        status: "planned",
        owner: "Q·A",
        detail:
          "Vesting — time-locked multi-sig contracts (#81). Alongside user profiles and contacts, which build on the existing Contact model rather than starting fresh.",
      },
      {
        label: "Buffer",
        start: 12,
        span: 1,
        status: "planned",
        detail:
          "Buffer month — absorbs slippage, finalizes reporting, plans the next cycle. No fixed feature commitments.",
      },
    ],
  },
];

/** Headline numbers for the summary strip. */
export const STATS = [
  {
    k: "Shipped",
    v: "6",
    n: "workstreams delivered in May–July",
    tone: "good" as const,
  },
  {
    k: "Ahead of plan",
    v: "4",
    n: "capabilities landed early, freeing Nov–Dec",
    tone: "good" as const,
  },
  {
    k: "Unreleased",
    v: "75",
    n: "commits on preprod, not on main",
    tone: "bad" as const,
  },
  {
    k: "Migrations due",
    v: "4",
    n: "pending against production",
    tone: "bad" as const,
  },
  {
    k: "Flagship",
    v: "Aug",
    n: "Document Sign-Off build begins",
    tone: "neutral" as const,
  },
];

/** Capability that arrived before its planned month, and what that freed up. */
export const AHEAD_OF_SCHEDULE = [
  {
    capability: "Governance metadata fix (#122)",
    planned: "Nov 26",
    delivered: "Jun 26",
    effect: "Closed five months early.",
  },
  {
    capability: "Bot platform — scoped auth, reference client, ballot API",
    planned: "Nov 26",
    delivered: "Jul 26",
    effect:
      "November reduces to webhooks only — the one piece with no code yet.",
  },
  {
    capability: "API documentation & developer portal",
    planned: "Dec 26",
    delivered: "Jun–Jul 26",
    effect:
      "Done. Swagger UI, a 1841-line OpenAPI spec, /llms.txt and a downloadable agent skill. December slot freed.",
  },
  {
    capability: "Pending transactions on homepage (#125)",
    planned: "Nov 26",
    delivered: "Shipped",
    effect:
      "Surfaced on the wallets dashboard. Issue still open — verify and close.",
  },
  {
    capability: "Playwright E2E suite",
    planned: "Unscheduled",
    delivered: "Jun–Jul 26",
    effect: "Becomes the safety net Document Sign-Off ships against.",
  },
];

/** What the product can do today, verified against the codebase on 2026-07-26. */
export const DELIVERED = [
  {
    title: "Governance",
    points: [
      "In-app voting for multisig DReps — budget voting, registration detection, ballot UX, DB-cached tallies.",
      "Public DRep explorer — vote history with search and filters, rationales resolved from IPFS, CSV export. No wallet required.",
      "Rationale drafting, IPFS reliability, ballot CSV import and export.",
    ],
  },
  {
    title: "Bot platform",
    points: [
      "Human-in-the-loop onboarding — a bot registers, its owner approves a 30-minute claim code, the secret is retrieved once.",
      "Double opt-in authorization — five scopes on the key and a per-wallet grant.",
      "27 endpoints reachable by bots, including signing with auto-submit at threshold. A bot can never move funds alone.",
      "Rate limiting at 60/min by default, 5/min on secret rotation.",
    ],
  },
  {
    title: "Developer & agent surface",
    points: [
      "/api-docs — Swagger UI with a wallet-signature token generator.",
      "/api/swagger — a 1841-line OpenAPI 3.0 spec.",
      "/llms.txt and /api/skill — agent orientation and a downloadable skill.",
    ],
  },
  {
    title: "Notifications",
    points: [
      "A real outbox — idempotency keys, retry backoff, nine delivery statuses including four distinct skip reasons.",
      "Per-wallet, per-signer settings and hashed-token email verification.",
      "Gap: nothing drains it on a schedule yet.",
    ],
  },
  {
    title: "Testing & CI",
    points: [
      "11 Playwright specs, ~54 tests — wallet creation, real preprod ring transfers, staking, proxy, governance, bot management, access control.",
      "Real-chain smoke system closed; migrations running on Node 22.",
    ],
  },
  {
    title: "Platform",
    points: [
      "Mesh 2.0 groundwork — Prisma 7.8, Next 16, wallet operations behind a single bridge.",
      "Signing and auth reliability; byte-preserving witness merge, regression-tested.",
      "Mobile foundations, empty states, landing, SEO, glass theme.",
    ],
  },
];
