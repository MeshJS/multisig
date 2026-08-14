---
title: "What is Cardano multisig? A guide to M-of-N treasuries"
description: "A plain-English guide to multi-signature wallets on Cardano: how native-script M-of-N signing works, why teams and DAOs use it, and how to set up a multisig treasury with Mesh Multisig."
date: "2026-06-26"
tags: ["cardano multisig", "treasury", "native scripts", "dao", "security"]
author: "Mesh"
---

A **multisig** (multi-signature) wallet requires more than one signature to move funds. Instead of a single private key controlling the money, a group of signers each hold their own key, and a transaction only settles once enough of them approve. On Cardano this is enforced on-chain by **native scripts** — no smart contract or custodian required.

## M-of-N signing

Multisig is usually described as **M-of-N**: of `N` total signers, any `M` must sign for a transaction to be valid. A few common shapes:

- **2-of-3** — a small team where any two members can act, tolerant of one lost key
- **3-of-5** — a DAO working group that wants a real quorum before funds move
- **all-of-N** — every signer must approve, for maximum control

You choose the threshold per wallet. The moment the `M`-th valid signature lands, the transaction can be submitted; until then, the funds simply can't move.

## Why teams use it

A single private key is a single point of failure: lose it and the funds are gone; leak it and they're stolen. Multisig removes that:

- **No single point of failure.** One compromised or lost key isn't enough to move funds.
- **Shared control.** Treasuries belong to the group, not to whoever happens to hold the key.
- **Accountability.** Every signer is invited and verified, and every approval is recorded.

This is why DAOs, project treasuries, and multi-person teams reach for multisig rather than passing one seed phrase around.

## How it works on Cardano

Cardano's native scripts express signing rules directly at the protocol level. A multisig wallet is defined by a script listing the signers' key hashes and the required threshold. Because it's native, validation is cheap, predictable, and doesn't depend on a third-party contract.

When someone proposes a transaction, it's shared with the other signers. Each signs with their own wallet, contributing a witness. Once the threshold is met, the combined transaction is submitted to the chain.

## Setting up a multisig with Mesh Multisig

[Mesh Multisig](/) is a free, open-source, Cardano-native wallet built for exactly this:

1. **Create a wallet** and choose your `M`-of-`N` threshold.
2. **Invite signers** with a link; each is verified before they're added.
3. **Propose transactions** and route them to the required signers.
4. **Review and sign** — anyone can see pending transactions and who has approved.

You can also participate in **Cardano governance** as a group — vote on proposals and register as a DRep — all under the same multi-signature security.

## Going further

Once your treasury is running, you can automate the read-and-draft busywork by [connecting an AI agent](/blog/connect-an-ai-agent-to-your-cardano-multisig) or a bot to the REST API — while signing stays firmly with your co-signers.

Multisig turns a treasury from "whoever holds the key" into a transparent, shared, fault-tolerant system. On Cardano, it's native, free to use, and a few minutes to set up.
