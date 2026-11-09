---
type: feature
area: Document Sign-Off
state: in-progress
owner: Quirin
milestone: 2026-09
prs: [375]
updated: 2026-10-16
---

# Revision Provenance

Version 1 of Sign-Off: revision history as a first-class object, diff and rollback,
and a richer audit export. Still entirely off-chain.

- **History** — every version gets a platform attestation, chained to the one before
  it, so inserting, removing, reordering or back-dating a version is detectable
  offline (#375).
- **Diff** — any two versions of a document compare by metadata always, and line by
  line when both carry their bytes inline as text. Hash-only versions say why there
  is no line diff instead of guessing.
- **Rollback** — restore re-publishes an earlier version's exact content as a new
  version. Append-only: nothing in between is deleted, the restore is logged and
  attested, and approvals never come back — signers approve the restored content
  again from zero.
- **Audit export** — `mesh-multisig.document-signoff.audit.v1`: every version with its
  lineage and its standalone `proof.v1`, the whole event log, and the attestation
  chain with its keys, verifiable offline.

## Related

[[Document Sign-Off MVP]] · [[On-Chain Checkpoints]]
