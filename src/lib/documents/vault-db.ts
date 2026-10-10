import { createHmac, randomBytes } from "crypto";

import type { PrismaClient } from "@prisma/client";

import { buildTrustGraph, type VaultDoc } from "@/lib/vault-proof/trust-graph";
import { canonicalize } from "@/lib/documents/payload";
import type { VaultTrustNote, VaultTrustView } from "@/lib/vault-trust-types";

/**
 * A wallet's own vault, built from the database.
 *
 * The demo at /vault reads this repo's `vault/` directory, which answers "what
 * would shielded sign-off look like" but not "how do I get one". This builds
 * the same {@link VaultTrustView} from a wallet's real documents, so the same
 * browser renders it and nothing about the UI has to know where the notes came
 * from.
 *
 * THE MAPPING
 *
 * `Document.documentType` already groups documents the way `area:` grouped
 * features, so it becomes the proxy hub. The spine is:
 *
 *     blinded root -> document type -> document
 *
 * Hubs never point back at each other and documents never point at hubs, so the
 * trust graph is acyclic by construction — the same property the file-backed
 * vault gets from `area:`.
 *
 * WHAT A DOCUMENT NODE COMMITS TO
 *
 * Its latest version's identity, not its bytes: the content hash, the version
 * number and the status, canonicalised. That is deliberate — most documents
 * here are `hashOnly` and their bytes are not on the server at all, and the
 * content hash already commits to them. So the vault commits to the hash that
 * commits to the document, and works identically whether or not the body was
 * ever stored.
 */

/** 32 bytes of hex. One per wallet, generated on first use. */
function newVaultSalt(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Per-node salt, derived from the wallet's secret.
 *
 * Unguessable without `vaultSalt`, which is what makes withholding a short
 * document meaningful: an outsider holding the root cannot brute-force a node
 * from a guessed title.
 */
function saltFor(vaultSalt: string, nodeId: string): string {
  return createHmac("sha256", Buffer.from(vaultSalt, "hex"))
    .update(nodeId, "utf8")
    .digest("hex");
}

/**
 * Node ids double as display labels, and `buildTrustGraph` refuses duplicates —
 * so two documents sharing a title, or a document titled like its own type,
 * would fail the build. Disambiguate deterministically instead of throwing: a
 * naming collision is a normal thing for users to do.
 */
function uniqueId(
  preferred: string,
  taken: Set<string>,
  discriminator: string,
) {
  let id = preferred.trim() || "Untitled";
  if (taken.has(id)) id = `${id} (${discriminator.slice(-6)})`;
  let n = 2;
  while (taken.has(id)) id = `${preferred} (${discriminator.slice(-6)}-${n++})`;
  taken.add(id);
  return id;
}

const UNCATEGORISED = "Uncategorised";

/** Ensures the wallet has a vault secret, returning it. */
export async function ensureWalletVaultSalt(
  db: PrismaClient,
  walletId: string,
): Promise<string> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { vaultSalt: true },
  });
  if (!wallet) throw new Error(`Wallet ${walletId} not found`);
  if (wallet.vaultSalt) return wallet.vaultSalt;

  const vaultSalt = newVaultSalt();
  await db.wallet.update({ where: { id: walletId }, data: { vaultSalt } });
  return vaultSalt;
}

export async function buildWalletVaultView(
  db: PrismaClient,
  walletId: string,
): Promise<VaultTrustView> {
  const vaultSalt = await ensureWalletVaultSalt(db, walletId);

  const documents = await db.document.findMany({
    where: { walletId, status: { not: "Archived" } },
    orderBy: { title: "asc" },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });

  const taken = new Set<string>();
  const docs: VaultDoc[] = [];
  const notes: VaultTrustNote[] = [];
  const childrenOfHub = new Map<string, string[]>();

  // Hubs first, so a document can never steal a type's name.
  const hubNames = [
    ...new Set(documents.map((d) => d.documentType?.trim() || UNCATEGORISED)),
  ].sort((a, b) => a.localeCompare(b));
  const hubIds = new Map<string, string>();
  for (const name of hubNames) {
    const id = uniqueId(name, taken, name);
    hubIds.set(name, id);
    childrenOfHub.set(id, []);
  }

  for (const document of documents) {
    const hubName = document.documentType?.trim() || UNCATEGORISED;
    const hubId = hubIds.get(hubName)!;
    const id = uniqueId(document.title, taken, document.id);
    const latest = document.versions[0];

    childrenOfHub.get(hubId)!.push(id);

    docs.push({
      id,
      salt: saltFor(vaultSalt, document.id),
      content: canonicalize({
        contentHash: latest?.contentHash ?? null,
        status: document.status,
        title: document.title,
        versionNumber: latest?.versionNumber ?? 0,
      }),
      trusts: [],
    });

    notes.push({
      id,
      kind: "feature",
      area: hubId,
      state: document.status,
      owner: document.createdBy,
      body:
        (document.description?.trim()
          ? `${document.description.trim()}\n\n`
          : "") +
        (latest
          ? `Version ${latest.versionNumber} · ${latest.status}\n\n` +
            `Content hash \`${latest.contentHash}\``
          : "No versions yet."),
      // Wikilinks come from stored draft bodies; nothing writes them yet, so
      // the logical layer is empty rather than fabricated.
      links: [],
      hash: "",
    });
  }

  for (const [name, id] of hubIds) {
    docs.push({
      id,
      salt: saltFor(vaultSalt, `hub:${name}`),
      content: canonicalize({ hub: name }),
      trusts: childrenOfHub.get(id) ?? [],
    });
    notes.push({
      id,
      kind: "area",
      area: null,
      state: null,
      owner: null,
      body: `${(childrenOfHub.get(id) ?? []).length} document(s) in ${name}.`,
      links: [],
      hash: "",
    });
  }

  const built = buildTrustGraph(docs);
  if (!built.ok) {
    // Unlike the file-backed vault this cannot be caused by a bad edit in the
    // repo — the shape is derived here, so a failure is a bug in this function.
    throw new Error(`wallet vault graph: ${built.errors.join("; ")}`);
  }

  for (const note of notes) {
    note.hash = built.graph.nodes.get(note.id)?.hash ?? "";
  }

  return {
    rootHash: built.graph.rootHash,
    hubs: [...hubIds.values()].sort((a, b) => a.localeCompare(b)),
    notes: notes.sort((a, b) => a.id.localeCompare(b.id)),
    trustEdges: [...childrenOfHub.entries()].flatMap(([hub, kids]) =>
      kids.map((child) => ({ from: hub, to: child })),
    ),
    // Every document hangs off a type, so there is nothing outside the spine.
    orphans: [],
  };
}
