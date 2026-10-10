---
title: "Connect an AI agent to your Cardano multisig"
description: "Drop the Mesh Multisig skill into Claude Code, Cursor, or any agent and let it read pending transactions, draft payouts, and track approvals through the REST v1 API — without ever holding your keys."
date: "2026-06-29"
tags: ["ai agents", "cardano multisig", "automation", "developer tools"]
author: "Mesh"
---

AI agents are good at the parts of treasury work that humans find tedious: watching for pending transactions, drafting routine payouts, reconciling who has signed what, and summarizing activity. They are **not** something you should ever hand your signing keys to. Mesh Multisig is built around exactly that split — an agent can do the busywork, while signing stays with you and your co-signers.

This post walks through connecting an AI agent to your multisig wallet using the downloadable **multisig skill**.

## What the skill gives your agent

The skill is a single Markdown file that teaches an agent how Mesh Multisig works: the REST v1 endpoints, bot authentication, wallet flows, and the conventions the API expects. Drop it into Claude Code, Cursor, or any agent framework and it can immediately reason about your treasury.

You can grab it from the **Download skill** button on the homepage, or directly from `/api/skill`.

## What an agent can — and can't — do

Once connected, an agent works through the same authenticated v1 API a bot uses. In practice that means it can:

- **Read pending transactions** for any wallet it has access to
- **List free UTxOs** and wallet balances
- **Draft transactions** and queue them for the required signers
- **Track approvals** — report who still needs to sign to reach quorum

What it cannot do is sign. Signatures are produced by the human co-signers holding the keys; the agent never sees them. This is the whole point of multisig: no single party — human or machine — can move funds alone.

## A typical prompt

Connecting is as simple as pointing the agent at your wallet:

> Connect to my https://multisig.meshjs.dev/ wallet, list the pending transactions on our treasury, and tell me who still needs to sign the latest payout.

The agent authenticates, queries the v1 endpoints, and reports back. When it drafts a new payout, the transaction lands in your pending queue for the signers to review and approve — exactly as if a teammate had created it.

## Authentication, briefly

Agents authenticate as bots. You create a bot key in the app (**User → Create bot**), then the agent calls `POST /api/v1/botAuth` with the key and a payment address to receive a short-lived JWT. Every subsequent request carries that token. Each bot key maps to one payment address, which is the identity used across `walletIds`, `pendingTransactions`, `freeUtxos`, and the rest of the v1 surface.

## Why this is safe by design

Because signing authority is cryptographic and stays with the key holders, granting an agent API access is low-risk: the worst it can do is read data and propose transactions that still require human approval. You get automation without surrendering custody.

Ready to try it? Download the skill, create a bot key, and point your agent at your wallet.
