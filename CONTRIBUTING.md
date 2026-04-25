# Contributing

Thanks for your interest in Mesh Multi-Sig. This document describes how we work on the project: filing issues, opening pull requests, and getting changes reviewed and merged.

> **Contributions are accepted against the `preprod` branch.** All PRs — external and internal — should target `preprod`, not `main`. Changes graduate from `preprod` to `main` after they run clean in the preprod environment and pass smoke CI. The only exception is a critical hotfix, which may target `main` directly.

## Who reviews what

- Core maintainers: **Quirin** and **Andre**.
- Every PR is reviewed by the contributor who did not author it. If the author is external, either maintainer can review.
- Ownership per feature area is tracked in [ROADMAP.md](ROADMAP.md#task-ownership). The owner for a given area gets first look.

## Filing an issue

Before opening an issue, search open and closed issues — many things are already tracked.

A good issue has:

- **Title:** one line describing the symptom, not the guess at a cause
- **Steps to reproduce:** exact clicks, URLs, inputs
- **Expected vs actual:** what should happen, what does happen
- **Environment:** browser, network (preprod / mainnet), wallet, commit or deploy URL
- **Logs or screenshots** if the bug is visible

Label the issue (`bug`, `enhancement`, `research`, etc.) and attach the relevant milestone from the [roadmap milestones](../../milestones) if one applies.

## Branches

- `main` — production. Only maintainers merge to `main`.
- `preprod` — integration branch deployed to the preprod environment and exercised by the smoke CI.
- Feature / fix branches use a short prefix matching intent:
  - `feature/<slug>` — new user-facing capability
  - `fix/<slug>` — bug fix
  - `refactor/<slug>` — internal change, no behavior change
  - `docs/<slug>` — docs only
  - `chore/<slug>` — tooling, dependencies, build

Branch off `preprod` by default. Branch off `main` only for hotfixes that need to ship immediately.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short imperative summary>

<optional body explaining the why>
```

Types in use: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`.

Keep the subject under 72 characters. Write the body when the "why" is non-obvious — a linked issue, a tradeoff, a constraint. Don't restate the diff.

## Pull requests

Open the PR against `preprod` unless it's a hotfix for `main`.

Your PR description should include:

- **What** the change does in one or two sentences
- **Why** — the issue, incident, or decision it addresses (link the issue: `Closes #123`)
- **How to test** — concrete steps a reviewer can run to verify, including any preprod URL
- **Screenshots or recordings** for UI changes
- **Risk** — anything a reviewer should look at closely (migrations, auth, on-chain behavior)

Before requesting review:

- [ ] Rebased on the latest target branch
- [ ] Type-check and lint pass locally (`npm run build`, `npm run lint`)
- [ ] New or changed logic is covered by tests where practical
- [ ] Smoke CI is green on the PR (or the failure is understood and unrelated)
- [ ] UI changes have been loaded in a browser, not just type-checked

## Review

Reviewers look for:

1. Correctness — does the change actually do what it says?
2. Scope — no drive-by refactors, no unrelated cleanup, no half-finished migrations
3. Security — input validation at boundaries, no secrets committed, RLS intact, no new injection surface
4. Tests — is the happy path covered? The failure modes you'd expect a user to hit?
5. Docs — if behavior changed, did docs and examples move too?

Review etiquette:

- Comment with intent: `nit:` (optional), `question:` (clarify), `blocking:` (must address before merge)
- Prefer suggestions over prose when the change is mechanical
- Resolve your own threads after addressing feedback; don't resolve someone else's

Two weak approvals do not substitute for one careful review. If a change touches unfamiliar territory, say so and ask the owner to take a pass.

## Merging

- Squash merge by default — keep `main` history linear and each commit a complete change.
- Only merge when:
  - At least one approval from a maintainer who did not author the PR
  - CI is green (or failure is documented and unrelated)
  - All blocking comments resolved
- The author merges. If the author is external, the reviewing maintainer merges.

## Security

Don't open public issues for vulnerabilities. Email the maintainers directly and we'll coordinate a fix.

## Questions

If you're unsure whether something belongs in scope, open a draft PR or an issue with the `question` label — we'd rather discuss early than review a large change that needs to be redone.
