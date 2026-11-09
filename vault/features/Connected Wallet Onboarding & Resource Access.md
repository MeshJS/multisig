---
type: feature
area: Platform & UX
state: planned
owner: Andre
milestone: 2026-11
updated: 2026-10-19
---

# Connected Wallet Onboarding & Resource Access

Scheduled for **MRP Month 8 — November 2026**, owned by **Andre**.

## Problem

The navigation review on 2026-10-19 found that signing in replaces the landing
page at `/` with the wallet dashboard. The MCP setup guide at `/#connect-mcp`
and Developers & Bots section at `/#developers-and-bots` disappear with it;
the footer's Developers & Bots link therefore has no matching section after
sign-in. The dashboard and private wallet pages also hide the resource footer.

`/bot-setup` has no normal UI entry point. Roadmap, feature graph, Blog, and the
public sign-off demo remain reachable through public-page footers, but are absent
from the persistent Resources menu. `/verify` is linked from Documents, while
the standalone `/dapps` route has no global entry point despite the same content
being available through a selected wallet's Dapps menu.

The responsive layout review also found four issues, reproduced using the app's
layout classes and representative content at widths from 375 to 1440 pixels
(isolated layout checks, not a live connected-wallet session):

- **Wallet Overview:** a one-column grid contains cards spanning two columns,
  creating an unintended second column. AI client activity and Contacts occupy
  separate, uneven columns in the same row and become cramped on narrow screens.
- **Wallet Assets:** the only card occupies one cell in a two-/three-column grid,
  leaving unused space and allowing action buttons to extend outside the card
  at intermediate widths.
- **Profile bot access grants:** a two-column profile layout combines with a
  three-column control row and a fixed-width role selector. At tablet widths,
  the wallet selector collapses and controls overlap or spill into nearby content.
- **Wallet Tasks:** four board columns activate at 768px, when the sidebar also
  appears. Task titles, selection controls, and menus have insufficient room.

Existing responsive smoke coverage checks 375px and 412px phones. Document-level
overflow checks alone miss overlap and content clipped by the app's scroll container.

## Planned scope

- Give the landing page a stable address available before and after sign-in
  (proposed: `/about`), with a distinct My wallets destination.
- Add persistent Learn & Help navigation on desktop and mobile, leading to
  Getting Started, Features, MCP setup, Bot Setup, API Docs, DApps integration,
  document verification, Blog, Roadmap, the feature graph, and the sign-off demo.
- Extract the full MCP guide into a standalone route (proposed: `/docs/mcp`),
  linked from the landing page, API Docs, and Connected AI clients. Replace
  homepage-only developer links with stable destinations.
- Add contextual guide links to the empty wallet dashboard, bot creation,
  AI connection management, and Documents. Keep onboarding dismissible and
  reopenable, covering create/import, inviting signers, and reviewing a first
  transaction, with automation and documents as optional next steps.
- Normalize the Overview layout into a consistent full-width stack for AI
  activity, Contacts, and the surrounding cards; any side-by-side arrangement
  must be intentional and responsive to available content width.
- Give the Assets card the available width and let its action buttons wrap.
- Give profile bot management sufficient width and stack grant controls when
  the card is narrow rather than relying only on viewport breakpoints.
- Keep fewer task board columns until sufficient content width is available,
  or use a deliberately scrollable board with a usable minimum column width.
- Extend responsive verification beyond phones to tablet and desktop widths,
  checking card/control boundaries and overlap as well as document overflow.
  Prioritize Overview, bot grants, and Tasks, followed by Assets.

## Acceptance criteria

- A signed-in user can reach the landing content and full MCP guide from visible
  navigation without disconnecting or entering a URL manually.
- Every learning resource above has a working path from Learn & Help on both
  desktop and mobile, with no dependency on first opening a public-page footer.
- Navigation preserves the wallet connection; public guidance also works while
  signed out. Existing action-specific authorization remains in place.
- Developers & Bots links and MCP guide links resolve to the intended content
  in either connection state, including existing homepage fragment links.
- A new user can reopen the onboarding guide after dismissal, and relevant
  dashboard/profile/document screens link to their setup instructions.
- Verify the navigation matrix for signed-out, signed-in with no multisig
  wallets, and signed-in with a selected multisig wallet, on desktop and mobile.
- Check Overview, Assets, profile bot grants, and Tasks at 375px, 412px, 768px,
  820px, 1024px, 1280px, and 1440px, with empty and populated states. Include
  expanded AI activity, existing contacts, bot grants, and payable task controls.
- AI activity and Contacts remain readable and intentionally aligned; Assets
  has no unused grid columns and its actions stay inside the card.
- Bot wallet/role selectors and grant actions remain usable without overlap;
  task titles, selection controls, and menus remain readable and reachable.
- Layout assertions check element bounds within cards and the visible content
  area, allowing only deliberate local scrolling. A passing document overflow
  check must not hide clipped or overlapping controls.

## Related

[[API Documentation Portal]] · [[Multisig MCP Server]] · [[Mobile & Responsive Foundations]]
