---
title: "How to use shielded sign-off"
description: "Prove one document belongs to your governance spine without revealing the rest of it. How the trust graph works, how to set your vault up, and what a disclosure actually gives away."
date: "2026-08-23"
tags:
  ["shielded sign-off", "document sign-off", "cardano multisig", "governance"]
author: "Mesh"
---

A counterparty asks you to prove your treasury has a spending policy, and that a
particular signer is authorised under it. You can send them the policy. What you
cannot easily do is send them _only_ that — not the other policies, not the names
of your other workstreams, not the shape of your internal governance.

Shielded sign-off is the answer to that. It is a way of hashing a set of linked
documents so that a single one can be proved to belong, on its own, while
everything beside it stays sealed.

This is a guide to the idea and to what the product does today. Where something
is not yet a button, this says so.

## Two kinds of link, and why they must stay apart

Documents reference each other. In a normal wiki those references form loops
freely — a charter mentions a policy, the policy mentions the charter — and
that is fine, because nothing depends on it.

Hashes cannot loop. If document A's hash covers B, and B's hash covers A,
neither can be computed. So the moment you want tamper-evidence, you have to
decide which references carry weight.

Shielded sign-off keeps two separate relations:

- **The logical relation.** Ordinary references between documents. They carry a
  name and nothing else, they may point anywhere including backwards, and they
  are deliberately absent from every hash. Cycles here are normal.
- **The trust relation.** A document's hash covers the hashes of everything it
  trusts, transitively. These must form a directed acyclic graph, and the build
  fails loudly — naming the exact chain — if they do not.

That separation is the whole trick. You keep the messy, human web of
cross-references, and you get a clean commitment underneath it.

## Proxy hubs: why one root is not enough

The naive structure is one root that commits to every document. It works, and it
leaks: to prove any single document belongs, you reveal the root, and the root
tells the recipient how many documents you have and how they are grouped.

So the spine has a middle layer:

```
blinded root
├── Governance      ← a hub
│   ├── Spending Limits
│   └── Signer Set
├── Legal           ← a different hub
│   └── Shareholder Agreement
└── Operations
    └── Incident Response
```

Each hub is a proxy for one angle of your organisation. Disclosing the
Governance hub proves a governance document belongs, without naming Legal or
Operations at all — the root commits to the hubs' **hashes**, never their
titles.

Every document also carries its own salt, so a short document cannot be
brute-forced from a guessed title. In your wallet's vault those salts are
derived from a per-wallet secret, which means a guessed title tells an outsider
nothing.

## Setting up your vault

Your vault is not a separate thing you create. It is built from the documents
you already have.

1. **Go to Documents → Vault** in your wallet. If it is empty, it says so and
   offers you the demo.
2. **Create documents and give them a type.** The type is what becomes the
   proxy hub — "Governance", "Legal", "Operations", whatever fits. Documents
   with no type land under _Uncategorised_, which works but discloses less
   usefully.
3. **Write or upload.** Either edit a draft in the browser and publish it, or
   upload a file. Uploading hashes the file locally and sends only the digest —
   the bytes never leave your machine unless you explicitly turn on server
   storage for that document.
4. **Sign off.** Approvals bind the exact content hash, so a new version resets
   approvals to zero. That is deliberate: your signers agreed to those bytes,
   not to the title.

The vault view then shows the spine: hubs on the left, the document you selected
in the middle, and on the right the path a proof of it would reveal — together
with the documents it would keep sealed, present only as hashes.

There is a public demo of exactly this at [/vault](/vault), built from Mesh
Multisig's own feature notes. It is real content with real hashes, and it is
useful for seeing the mechanism before you have documents of your own.

## What a disclosure gives away

This is the part worth understanding before you rely on it.

A disclosure of one document reveals:

- that document's content and salt,
- the hub it hangs under, and that hub's content,
- the **hashes** of that hub's other children,
- the **hashes** of the other hubs.

A recipient re-hashes upward and checks the result against the signed root. If
anything was altered, moved, or invented, the recomputation fails.

What they learn that you may not have intended: **how many** documents sit under
that hub, and **how many** hubs exist. Not their names, not their contents —
counts. If those counts are themselves sensitive, split your hubs differently.

What they do not learn: any other document's title or content, or anything about
hubs you did not disclose.

## What is not a button yet

The construction is implemented and tested — building the trust graph, producing
a disclosure, and verifying one against a root all exist as library code with
tests covering relabelling, reordering, tampering and cross-vault splicing.

**Exporting a disclosure from the UI is not wired up yet.** Today the vault view
_shows_ you what a disclosure of the selected document would reveal and withhold,
which is the part that changes how you organise your vault. Producing the
artefact you hand to a counterparty is the next step, not a shipped one.

Document sign-off itself is fully shipped: versions, content hashes,
threshold approvals bound to those hashes, a frozen signer snapshot per round,
and an offline-verifiable proof package you can export today.

## Why the structure is worth adopting now

Even before disclosure export lands, the vault changes something concrete: it
makes the relationship between your documents explicit and tamper-evident. A
signature over the root binds the whole structure beneath it, so "this was our
governance spine on that date" becomes a checkable claim rather than an
assertion.

And the organising work — giving documents types, deciding which grouping you
would be comfortable disclosing — is the part that takes judgement. The
cryptography is already written.
