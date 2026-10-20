/**
 * Document Sign-Off (PRD-001) — tRPC router.
 *
 * Six operations: createDocument, uploadVersion, startReview,
 * submitSignerAction, exportProof, verifyProof — plus the reads the four
 * Documents pages need.
 *
 * v1 (Revision Provenance) adds diffVersions, restoreVersion (rollback by
 * re-publishing, never by rewriting), and exportAudit / verifyAudit (the
 * whole document's record, checkable offline — src/lib/documents/audit.ts).
 *
 * Two rules carry the whole feature and are enforced here, not in the UI:
 *
 *  1. **Version-hash binding.** A review is attached to a DocumentVersion's
 *     content hash. The server rebuilds the signed payload from its own
 *     records and rejects the submission unless it is byte-identical to what
 *     the client signed, so a signature collected against one version can
 *     never be replayed onto another.
 *
 *  2. **Threshold inheritance from a frozen snapshot.** Required approvals
 *     come from the DocumentSignerSnapshot captured when the round started,
 *     never from the live wallet — changing the wallet's signers must not
 *     rewrite a decision that has already been made.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { checkSignature } from "@meshsdk/core";
import { Prisma, type Wallet } from "@prisma/client";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";
import { randomBytes } from "crypto";

import { audit } from "@/lib/observability/audit";
import { buildWalletVaultView } from "@/lib/documents/vault-db";
import {
  ATTESTATION_DOMAIN,
  ATTESTATION_STATEMENT,
  GENESIS_PREV,
  attestationHash,
  buildAttestationPayload,
  canonicalizeAttestation,
  verifyAttestationChain,
  type AttestationRecord,
} from "@/lib/documents/attestation";
import {
  getAttestationPublicKeys,
  getAttestationSigner,
} from "@/lib/documents/attestation-key";
import {
  buildSignOffPayload,
  canonicalizeSignOffPayload,
  evaluateThreshold,
  isSha256Hex,
  isSignedAtWithinTolerance,
  normalizeContentHash,
  sha256Hex,
  walletPolicyHash,
} from "@/lib/documents/payload";
import {
  buildProofPackage,
  proofPackageProblem,
  verifyProofPackage,
  type ProofPackage,
} from "@/lib/documents/proof";
import { diffVersions } from "@/lib/documents/diff";
import {
  AUDIT_LIMITS,
  auditPackageProblem,
  buildAuditPackage,
  verifyAuditPackage,
  type AuditPackage,
} from "@/lib/documents/audit";

/** Inline content is a convenience for small files, not a document store. */
const MAX_INLINE_BYTES = 512 * 1024;

const contentHashSchema = z
  .string()
  .trim()
  .transform(normalizeContentHash)
  .refine(isSha256Hex, { message: "contentHash must be a sha256 hex digest" });

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

const getSessionAddresses = (ctx: AuthCtx): string[] => {
  const sessionWallets: string[] = ctx.sessionWallets ?? [];
  if (Array.isArray(sessionWallets) && sessionWallets.length > 0) {
    return sessionWallets;
  }
  const single = ctx.session?.user?.id ?? ctx.sessionAddress;
  return single ? [single] : [];
};

/** Wallet membership: a signer or the owner. Mirrors the ballot router. */
const assertWalletAccess = async (
  ctx: AuthCtx,
  walletId: string,
): Promise<{ wallet: Wallet; addresses: string[] }> => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const addresses = getSessionAddresses(ctx);
  if (addresses.length === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const authorized = addresses.some(
    (addr) =>
      (Array.isArray(wallet.signersAddresses) &&
        wallet.signersAddresses.includes(addr)) ||
      wallet.ownerAddress === addr,
  );
  if (!authorized) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not authorized for this wallet",
    });
  }

  return { wallet, addresses };
};

const assertDocumentAccess = async (ctx: AuthCtx, documentId: string) => {
  const document = await ctx.db.document.findUnique({
    where: { id: documentId },
  });
  if (!document) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  }
  const { wallet, addresses } = await assertWalletAccess(
    ctx,
    document.walletId,
  );
  return { document, wallet, addresses };
};

/**
 * Document access for a caller who may be a wallet member, a named contract
 * party, or both.
 *
 * `assertDocumentAccess` authorizes only wallet members, which is correct for
 * sign-off and fatal for contracts: a counterparty is in neither
 * signersAddresses nor ownerAddress, so every document procedure rejects them
 * with FORBIDDEN before any party logic runs. This is the gate that lets them
 * in — and only to the document they were named on, never to the wallet.
 *
 * Returns EVERY party the caller holds, not one. One human may hold two roles,
 * so picking a single party here would silently choose a capacity on their
 * behalf; anything that acts as a party must be told which one.
 */
const resolveDocumentAccess = async (ctx: AuthCtx, documentId: string) => {
  const document = await ctx.db.document.findUnique({
    where: { id: documentId },
  });
  if (!document) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  }

  const addresses = getSessionAddresses(ctx);
  if (addresses.length === 0) throw new TRPCError({ code: "UNAUTHORIZED" });

  const wallet = await ctx.db.wallet.findUnique({
    where: { id: document.walletId },
  });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const isMember = addresses.some(
    (addr) =>
      (Array.isArray(wallet.signersAddresses) &&
        wallet.signersAddresses.includes(addr)) ||
      wallet.ownerAddress === addr,
  );

  // Only a REDEEMED party counts. An unredeemed row carries an address nobody
  // has proved control of — it is an intention to invite, not an identity.
  const parties = await ctx.db.contractParty.findMany({
    where: {
      documentId: document.id,
      address: { in: addresses },
      inviteConsumedAt: { not: null },
    },
    orderBy: [{ signingOrder: "asc" }, { id: "asc" }],
  });

  if (!isMember && parties.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not authorized for this document",
    });
  }

  return { document, wallet, addresses, parties, isMember };
};

/**
 * The party roster is frozen once a round starts.
 *
 * `startReview` copies the parties into DocumentSignerSnapshot, and the whole
 * feature rests on that snapshot being immutable — adding or removing a party
 * afterwards would leave the frozen list describing a set that no longer
 * exists, exactly the drift the snapshot was introduced to prevent. Mirrors the
 * existing "A review round has already started" guard.
 */
const assertPartyRosterOpen = async (ctx: AuthCtx, documentId: string) => {
  const latest = await ctx.db.documentVersion.findFirst({
    where: { documentId },
    orderBy: { versionNumber: "desc" },
    include: { signerSnapshot: true },
  });
  if (latest?.signerSnapshot) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A review round has already started for this document. The party " +
        "list is frozen until a new version is published.",
    });
  }
};

/** The acting address for a write — one of the session addresses. */
const actingAddress = (addresses: string[], claimed?: string): string => {
  if (claimed) {
    if (!addresses.includes(claimed)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "signerAddress is not one of your session addresses",
      });
    }
    return claimed;
  }
  const first = addresses[0];
  if (!first) throw new TRPCError({ code: "UNAUTHORIZED" });
  return first;
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const documentRouter = createTRPCRouter({
  /** Document list for a wallet — the list page. */
  listByWallet: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return ctx.db.document.findMany({
        where: {
          walletId: input.walletId,
          ...(input.includeArchived ? {} : { status: { not: "Archived" } }),
        },
        orderBy: { updatedAt: "desc" },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            include: {
              signerSnapshot: true,
              reviews: {
                select: { signerAddress: true, action: true, signedAt: true },
              },
            },
          },
        },
      });
    }),

  /** Full document with history — the detail page. */
  getById: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Party-aware: a counterparty must be able to read the contract they were
      // named on. Scoped to that one document — being a party grants nothing
      // anywhere else in the wallet.
      const { document } = await resolveDocumentAccess(ctx, input.documentId);
      return ctx.db.document.findUnique({
        where: { id: document.id },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            include: { signerSnapshot: true, reviews: true },
          },
          events: { orderBy: { createdAt: "asc" } },
        },
      });
    }),

  /**
   * Everything the review page needs, including the exact payload the signer
   * is about to sign. Handing the payload back from the server (rather than
   * letting the client compose it) is what makes "what you see is what you
   * sign" true — the same builder runs again on submit.
   */
  getVersionForReview: protectedProcedure
    .input(
      z.object({
        versionId: z.string().min(1),
        action: z.enum(["approve", "reject"]).default("approve"),
        comment: z.string().max(2000).optional(),
        signerAddress: z.string().min(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const version = await ctx.db.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: true, signerSnapshot: true, reviews: true },
      });
      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found",
        });
      }
      const { addresses } = await assertWalletAccess(
        ctx,
        version.document.walletId,
      );
      const signerAddress = actingAddress(addresses, input.signerAddress);

      const snapshot = version.signerSnapshot;
      const alreadyActed = version.reviews.find(
        (r) => r.signerAddress === signerAddress,
      );

      const payload = snapshot
        ? buildSignOffPayload({
            action: input.action,
            comment: input.comment,
            contentHash: version.contentHash,
            documentId: version.documentId,
            signedAt: new Date(),
            signerAddress,
            versionId: version.id,
            versionNumber: version.versionNumber,
            walletId: version.document.walletId,
            walletPolicyHash: snapshot.walletPolicyHash,
          })
        : null;

      return {
        version,
        document: version.document,
        snapshot,
        signerAddress,
        canSign:
          !!snapshot &&
          version.status === "InReview" &&
          snapshot.signersAddresses.includes(signerAddress) &&
          !alreadyActed,
        alreadyActed: alreadyActed ?? null,
        payload,
        payloadToSign: payload ? canonicalizeSignOffPayload(payload) : null,
      };
    }),

  /** 1. Create a document, optionally with its first version. */
  createDocument: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).optional(),
        documentType: z.string().max(100).optional(),
        firstVersion: z
          .object({
            contentHash: contentHashSchema,
            fileName: z.string().max(300).optional(),
            mimeType: z.string().max(200).optional(),
            fileSize: z.number().int().nonnegative().optional(),
            storageMode: z
              .enum(["hashOnly", "inline", "external"])
              .default("hashOnly"),
            contentRef: z.string().max(2000).optional(),
            contentInline: z.string().optional(),
            reviewInstructions: z.string().max(5000).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { addresses } = await assertWalletAccess(ctx, input.walletId);
      const creator = actingAddress(addresses);

      const document = await ctx.db.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            walletId: input.walletId,
            title: input.title,
            description: input.description ?? null,
            documentType: input.documentType ?? null,
            createdBy: creator,
            status: "Draft",
          },
        });

        await tx.documentEvent.create({
          data: {
            documentId: created.id,
            type: "document.created",
            actorAddress: creator,
            metadata: { title: created.title },
          },
        });

        if (input.firstVersion) {
          const version = await createVersionRow(tx, {
            documentId: created.id,
            versionNumber: 1,
            createdBy: creator,
            ...input.firstVersion,
          });
          await tx.documentEvent.create({
            data: {
              documentId: created.id,
              versionId: version.id,
              type: "version.uploaded",
              actorAddress: creator,
              metadata: {
                versionNumber: version.versionNumber,
                contentHash: version.contentHash,
              },
            },
          });
          await attestVersion(tx, version, input.walletId);
        }

        return created;
      });

      void audit(ctx.db, {
        actorAddress: creator,
        actorType: "user",
        action: "document.create",
        resourceType: "document",
        resourceId: document.id,
        outcome: "success",
        metadata: { walletId: input.walletId },
      });

      return document;
    }),

  /**
   * 2. Upload a new version. Approvals never carry forward: the previous
   *    version is superseded and the new one starts at zero approvals, because
   *    approval is bound to the content hash, not to the title.
   */
  uploadVersion: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        contentHash: contentHashSchema,
        fileName: z.string().max(300).optional(),
        mimeType: z.string().max(200).optional(),
        fileSize: z.number().int().nonnegative().optional(),
        storageMode: z
          .enum(["hashOnly", "inline", "external"])
          .default("hashOnly"),
        contentRef: z.string().max(2000).optional(),
        contentInline: z.string().optional(),
        reviewInstructions: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      if (document.status === "Archived") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Document is archived",
        });
      }
      const actor = actingAddress(addresses);

      const version = await ctx.db.$transaction((tx) =>
        appendVersion(tx, {
          document,
          actor,
          eventType: "version.uploaded",
          eventMetadata: {},
          row: {
            contentHash: input.contentHash,
            fileName: input.fileName,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            storageMode: input.storageMode,
            contentRef: input.contentRef,
            contentInline: input.contentInline,
            reviewInstructions: input.reviewInstructions,
          },
        }),
      );

      return version;
    }),

  /**
   * 3. Start a review round: freeze the wallet's signer set and threshold onto
   *    the version. Everything downstream reads the snapshot, not the wallet.
   */
  startReview: protectedProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.db.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: true, signerSnapshot: true },
      });
      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found",
        });
      }
      const { wallet, addresses } = await assertWalletAccess(
        ctx,
        version.document.walletId,
      );
      const actor = actingAddress(addresses);

      if (version.signerSnapshot) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A review round has already started for this version",
        });
      }
      if (version.status !== "Draft") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cannot start a review on a ${version.status} version`,
        });
      }

      const signers = wallet.signersAddresses ?? [];
      const required = wallet.numRequiredSigners ?? signers.length;
      if (signers.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Wallet has no signers",
        });
      }
      if (required < 1 || required > signers.length) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Wallet threshold is not usable",
        });
      }

      const result = await ctx.db.$transaction(async (tx) => {
        const snapshot = await tx.documentSignerSnapshot.create({
          data: {
            versionId: version.id,
            walletId: wallet.id,
            signersAddresses: signers,
            signersDescriptions: wallet.signersDescriptions ?? [],
            requiredSigners: required,
            walletPolicyHash: walletPolicyHash(wallet.scriptCbor),
          },
        });
        await tx.documentVersion.update({
          where: { id: version.id },
          data: { status: "InReview", reviewStartedAt: new Date() },
        });
        await tx.document.update({
          where: { id: version.documentId },
          data: { status: "InReview" },
        });
        await tx.documentEvent.create({
          data: {
            documentId: version.documentId,
            versionId: version.id,
            type: "review.started",
            actorAddress: actor,
            metadata: {
              requiredSigners: required,
              signerCount: signers.length,
              walletPolicyHash: snapshot.walletPolicyHash,
            },
          },
        });
        return snapshot;
      });

      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "document.review.start",
        resourceType: "document",
        resourceId: version.documentId,
        outcome: "success",
        metadata: { versionId: version.id, requiredSigners: required },
      });

      return result;
    }),

  /**
   * 4. Submit a signer's approve/reject with its CIP-8 signature.
   *
   * The submitted payload is never trusted. The server rebuilds it from its
   * own records and requires a byte-identical match before the signature is
   * even checked — a signature harvested for version 2 cannot be recorded
   * against version 3, and a tampered comment invalidates the whole thing.
   */
  submitSignerAction: protectedProcedure
    .input(
      z.object({
        versionId: z.string().min(1),
        action: z.enum(["approve", "reject"]),
        comment: z.string().max(2000).optional(),
        signerAddress: z.string().min(1),
        signedAt: z.string().min(1),
        payload: z.string().min(1),
        signature: z.string().min(1),
        signatureKey: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.db.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: true, signerSnapshot: true, reviews: true },
      });
      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found",
        });
      }
      const { addresses } = await assertWalletAccess(
        ctx,
        version.document.walletId,
      );
      const signerAddress = actingAddress(addresses, input.signerAddress);

      const deny = (
        reason: string,
        code: "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" = "BAD_REQUEST",
      ): never => {
        void audit(ctx.db, {
          actorAddress: signerAddress,
          actorType: "user",
          action: "document.review.submit",
          resourceType: "document",
          resourceId: version.documentId,
          outcome: "denied",
          reason,
          metadata: { versionId: version.id },
        });
        throw new TRPCError({ code, message: reason });
      };

      const snapshot = version.signerSnapshot;
      if (!snapshot)
        deny("No review round has been started for this version", "CONFLICT");
      if (version.status !== "InReview") {
        deny(`Version is ${version.status}, not open for review`, "CONFLICT");
      }
      if (!snapshot!.signersAddresses.includes(signerAddress)) {
        deny("Signer is not in this round's signer snapshot", "FORBIDDEN");
      }
      if (version.reviews.some((r) => r.signerAddress === signerAddress)) {
        deny("This signer has already acted on this version", "CONFLICT");
      }

      const signedAt = new Date(input.signedAt);
      if (Number.isNaN(signedAt.getTime()))
        deny("signedAt is not a valid date");
      if (!isSignedAtWithinTolerance(signedAt)) {
        deny("signedAt is outside the accepted time window");
      }

      // --- version-hash binding: rebuild, then compare byte for byte --------
      const expected = canonicalizeSignOffPayload(
        buildSignOffPayload({
          action: input.action,
          comment: input.comment,
          contentHash: version.contentHash,
          documentId: version.documentId,
          signedAt,
          signerAddress,
          versionId: version.id,
          versionNumber: version.versionNumber,
          walletId: version.document.walletId,
          walletPolicyHash: snapshot!.walletPolicyHash,
        }),
      );
      if (expected !== input.payload) {
        deny(
          "Signed payload does not match this document version — refusing to record the signature",
        );
      }

      // --- CIP-8: this address's key signed exactly that payload ------------
      let signatureValid = false;
      try {
        signatureValid = await checkSignature(
          input.payload,
          { key: input.signatureKey, signature: input.signature },
          signerAddress,
        );
      } catch (error) {
        deny(
          `Signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!signatureValid)
        deny("Invalid signature for this signer", "FORBIDDEN");

      const result = await ctx.db.$transaction(async (tx) => {
        const review = await tx.documentReview.create({
          data: {
            versionId: version.id,
            signerAddress,
            action: input.action,
            comment: input.comment ?? null,
            payload: input.payload,
            signature: input.signature,
            signatureKey: input.signatureKey,
            signedAt,
          },
        });

        await tx.documentEvent.create({
          data: {
            documentId: version.documentId,
            versionId: version.id,
            type:
              input.action === "approve"
                ? "review.approved"
                : "review.rejected",
            actorAddress: signerAddress,
            metadata: { versionNumber: version.versionNumber },
          },
        });

        const reviews = await tx.documentReview.findMany({
          where: { versionId: version.id },
        });
        const approvals = reviews.filter((r) => r.action === "approve").length;
        const rejections = reviews.filter((r) => r.action === "reject").length;
        const outcome = evaluateThreshold({
          approvals,
          rejections,
          signerCount: snapshot!.signersAddresses.length,
          requiredSigners: snapshot!.requiredSigners,
        });

        if (outcome !== "InReview") {
          await tx.documentVersion.update({
            where: { id: version.id },
            data: { status: outcome, decidedAt: new Date() },
          });
          await tx.document.update({
            where: { id: version.documentId },
            data: { status: outcome },
          });
          await tx.documentEvent.create({
            data: {
              documentId: version.documentId,
              versionId: version.id,
              type:
                outcome === "Approved"
                  ? "threshold.reached"
                  : "version.rejected",
              actorAddress: signerAddress,
              metadata: {
                approvals,
                rejections,
                requiredSigners: snapshot!.requiredSigners,
              },
            },
          });
        }

        return { review, approvals, rejections, outcome };
      });

      void audit(ctx.db, {
        actorAddress: signerAddress,
        actorType: "user",
        action: "document.review.submit",
        resourceType: "document",
        resourceId: version.documentId,
        outcome: "success",
        metadata: {
          versionId: version.id,
          action: input.action,
          result: result.outcome,
        },
      });

      return result;
    }),

  /** 5. Export the proof package for a version. */
  exportProof: protectedProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<ProofPackage> => {
      const version = await ctx.db.documentVersion.findUnique({
        where: { id: input.versionId },
        include: {
          document: { include: { events: { orderBy: { createdAt: "asc" } } } },
          signerSnapshot: true,
          reviews: {
            orderBy: { signedAt: "asc" },
            include: { party: { select: { role: true } } },
          },
        },
      });
      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found",
        });
      }
      const { addresses } = await assertWalletAccess(
        ctx,
        version.document.walletId,
      );
      const actor = actingAddress(addresses);

      const snapshot = version.signerSnapshot;
      if (!snapshot) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This version has no review round to export",
        });
      }

      const pkg = buildProofPackage({
        document: version.document,
        version,
        snapshot,
        reviews: version.reviews,
        events: version.document.events,
        exportedAt: new Date(),
      });

      await ctx.db.documentEvent.create({
        data: {
          documentId: version.documentId,
          versionId: version.id,
          type: "proof.exported",
          actorAddress: actor,
          metadata: { reviewCount: pkg.reviews.length },
        },
      });

      return pkg;
    }),

  /**
   * 6. Verify a proof package. Public on purpose: a counterparty holding the
   *    JSON and the file must be able to check it without an account, and this
   *    endpoint reads nothing from the database — it only re-runs the maths.
   */
  verifyProof: publicProcedure
    .input(
      z.object({
        proof: z.unknown(),
        /** sha256 of the bytes the verifier holds, if they have the file. */
        expectedContentHash: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const problem = proofPackageProblem(input.proof);
      if (problem !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      }
      const pkg = input.proof as ProofPackage;
      // The shape check covers every field the verifier reads; this catches
      // what it cannot, such as a signed payload too deeply nested to
      // canonicalize, so the answer is still a 400 and never a 500.
      try {
        return await verifyProofPackage(pkg, {
          expectedContentHash: input.expectedContentHash,
          checkSignature,
        });
      } catch (error) {
        // Logged so a real verifier bug does not hide behind the 400.
        console.warn(
          "[document.verifyProof] verifier threw:",
          error instanceof Error ? error.message : String(error),
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That proof package could not be verified — it is malformed.",
        });
      }
    }),

  /**
   * Export a document's attestation chain, with the public keys needed to check
   * it. Deliberately separate from `exportProof`: that package is a versioned
   * format (`...proof.v1`) whose field names are a contract, and quietly adding
   * to it would change what every existing verifier is parsing.
   */
  exportAttestationChain: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { document } = await assertDocumentAccess(ctx, input.documentId);

      const rows = await ctx.db.documentAttestation.findMany({
        where: { documentId: document.id },
        orderBy: { sequence: "asc" },
      });

      return {
        format: ATTESTATION_DOMAIN,
        documentId: document.id,
        title: document.title,
        // What the signature does and does not mean, carried with the export so
        // it does not depend on the reader having found the docs.
        statement: ATTESTATION_STATEMENT,
        publicKeys: getAttestationPublicKeys(),
        chain: rows.map((row) => ({
          payload: JSON.parse(row.payload) as unknown,
          signature: row.signature,
          publicKeyId: row.publicKeyId,
        })),
      };
    }),

  /**
   * Check an attestation chain. Public, like `verifyProof`, so a recipient can
   * verify one without an account — though they do not need us at all: the
   * algorithm is in src/lib/documents/attestation.ts and depends on nothing but
   * node crypto.
   */
  verifyAttestationChain: publicProcedure
    .input(
      z.object({
        // Bounded like the chain inside an audit package: every record costs
        // an Ed25519 verify, and this endpoint needs no account.
        chain: z
          .array(
            z.object({
              // An object, not z.unknown(): a null payload used to reach the
              // verifier and throw. Checked rather than parsed, so the object
              // reaches the verifier exactly as sent — a payload carrying an
              // extra field must fail its signature, not be trimmed back into
              // one that verifies.
              payload: z.custom<object>(
                (v) => !!v && typeof v === "object" && !Array.isArray(v),
                "payload must be an object",
              ),
              signature: z.string(),
              publicKeyId: z.string(),
            }),
          )
          .max(AUDIT_LIMITS.chain),
        /** Omit to check against the keys this deployment publishes. */
        publicKeys: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return verifyAttestationChain(
          input.chain as unknown as AttestationRecord[],
          input.publicKeys ?? getAttestationPublicKeys(),
        );
      } catch (error) {
        console.warn(
          "[document.verifyAttestationChain] verifier threw:",
          error instanceof Error ? error.message : String(error),
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That attestation chain could not be verified — it is malformed.",
        });
      }
    }),

  /**
   * The draft body, if there is one. Returns null rather than throwing when a
   * document has never been edited, so the editor can open on an empty page.
   */
  getDraft: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { document } = await assertDocumentAccess(ctx, input.documentId);
      return ctx.db.documentDraft.findUnique({
        where: { documentId: document.id },
      });
    }),

  /**
   * Save the draft body.
   *
   * Never touches DocumentVersion. That is the whole reason the draft exists:
   * `uploadVersion` supersedes the previous version and resets approvals to
   * zero, so autosaving through it would destroy in-flight approvals every few
   * keystrokes and append an attestation link each time.
   *
   * Concurrency is optimistic on `revision`. A save presents the revision it
   * read; if someone else saved in the meantime this is a conflict rather than
   * a silent overwrite. That is what makes more than one person editing safe
   * here — a CRDT would need a broker and a socket server, and this deployment
   * has neither.
   */
  saveDraft: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        body: z.string().max(MAX_INLINE_BYTES),
        /** The revision the editor last read. Omit only when creating. */
        expectedRevision: z.number().int().nonnegative().optional(),
        /** Opt in to storing the body server-side. */
        storeBody: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      const actor = actingAddress(addresses);

      const existing = await ctx.db.documentDraft.findUnique({
        where: { documentId: document.id },
      });

      if (!existing) {
        return ctx.db.documentDraft.create({
          data: {
            documentId: document.id,
            body: input.storeBody ? input.body : null,
            storeBody: input.storeBody ?? false,
            revision: 1,
            updatedBy: actor,
          },
        });
      }

      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== existing.revision
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `This draft moved on while you were editing (you had revision ` +
            `${input.expectedRevision}, it is now ${existing.revision}). ` +
            `Reload before saving so nobody's work is overwritten.`,
        });
      }

      const storeBody = input.storeBody ?? existing.storeBody;
      return ctx.db.documentDraft.update({
        where: { documentId: document.id },
        data: {
          body: storeBody ? input.body : null,
          storeBody,
          revision: { increment: 1 },
          updatedBy: actor,
        },
      });
    }),

  /**
   * Promote the draft to a signable version — the one-way door.
   *
   * The server serialises and hashes; the client never supplies the hash. That
   * mirrors the rule the rest of this router already follows, and it is what
   * makes "what you sign is what was published" true rather than asserted.
   *
   * Only from here does content enter the immutable world: a DocumentVersion,
   * an attestation link, and eventually signatures.
   */
  publishDraft: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        fileName: z.string().max(300).optional(),
        reviewInstructions: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      if (document.status === "Archived") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Document is archived",
        });
      }
      const actor = actingAddress(addresses);

      const draft = await ctx.db.documentDraft.findUnique({
        where: { documentId: document.id },
      });
      if (!draft?.storeBody || draft.body === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This draft is not stored on the server, so there is nothing here " +
            "to publish. Upload the file instead, or turn on server storage.",
        });
      }

      const bytes = Buffer.from(draft.body, "utf8");
      if (bytes.length > MAX_INLINE_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Draft exceeds ${MAX_INLINE_BYTES} bytes`,
        });
      }

      return ctx.db.$transaction((tx) =>
        appendVersion(tx, {
          document,
          actor,
          eventType: "version.published",
          eventMetadata: { fromDraftRevision: draft.revision },
          row: {
            contentHash: sha256Hex(bytes),
            fileName: input.fileName ?? `${document.title}.md`,
            mimeType: "text/markdown",
            fileSize: bytes.length,
            storageMode: "inline",
            contentInline: bytes.toString("base64"),
            reviewInstructions: input.reviewInstructions,
          },
        }),
      );
    }),

  /**
   * This wallet's documents as a vault: the same trust graph the /vault demo
   * shows, built from real rows instead of this repo's `vault/` directory.
   *
   * Grouped by documentType, which becomes the proxy hub, so the spine is
   * blinded root -> type -> document and is acyclic by construction.
   */
  vaultView: protectedProcedure
    .input(z.object({ walletId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return buildWalletVaultView(ctx.db, input.walletId);
    }),

  /**
   * Permanently delete a document.
   *
   * Everything cascades: versions, signatures, signer snapshots, attestations
   * and the document's own event log. There is no tombstone and no undo, which
   * is why this is not the default — `archiveDocument` keeps all of it and
   * merely removes the document from active use.
   *
   * Two guards, because this is an accountability product:
   *
   *  - A document anyone has SIGNED requires the caller to retype its title.
   *    Deleting it destroys the evidence that those people approved something,
   *    and that must not be one stray click.
   *  - An AuditLog row is written BEFORE the delete, recording who removed what
   *    and how much went with it. AuditLog holds no foreign key to Document, so
   *    unlike DocumentEvent it survives the cascade: the document goes, the
   *    fact that someone deleted it does not.
   */
  deleteDocument: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        /** Must equal the document's title once any signature exists. */
        confirmTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      const actor = actingAddress(addresses);

      const [signatureCount, versionCount, attestationCount] =
        await Promise.all([
          ctx.db.documentReview.count({
            where: { version: { documentId: document.id } },
          }),
          ctx.db.documentVersion.count({ where: { documentId: document.id } }),
          ctx.db.documentAttestation.count({
            where: { documentId: document.id },
          }),
        ]);

      if (signatureCount > 0 && input.confirmTitle !== document.title) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `This document carries ${signatureCount} signature` +
            `${signatureCount === 1 ? "" : "s"}. Retype the title to confirm.`,
        });
      }

      // Awaited, and before the delete: once the row is gone the cascade has
      // taken every DocumentEvent with it, so this is the only surviving trace.
      await audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "document.delete",
        resourceType: "document",
        resourceId: document.id,
        outcome: "success",
        metadata: {
          walletId: document.walletId,
          title: document.title,
          versionCount,
          signatureCount,
          attestationCount,
        },
      });

      await ctx.db.document.delete({ where: { id: document.id } });
      return { deleted: true, signatureCount, versionCount };
    }),

  /**
   * The contract parties on a document. Visible to wallet members and to the
   * parties themselves — a counterparty needs to see who else is signing.
   */
  listContractParties: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await resolveDocumentAccess(ctx, input.documentId);
      const parties = await ctx.db.contractParty.findMany({
        where: { documentId: input.documentId },
        orderBy: [{ signingOrder: "asc" }, { createdAt: "asc" }],
        include: { fields: true },
      });
      // The invite hash never leaves the server: it is the credential.
      return parties.map(({ inviteTokenHash: _hash, ...party }) => ({
        ...party,
        invited: !!party.invitedAt,
        redeemed: !!party.inviteConsumedAt,
      }));
    }),

  /**
   * Add or edit a party. Wallet members only — a counterparty may sign a
   * contract, never rewrite who else is on it.
   */
  upsertContractParty: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        partyId: z.string().min(1).optional(),
        role: z.string().trim().min(1).max(100),
        displayName: z.string().trim().min(1).max(200),
        email: z.string().email().max(320).optional(),
        signingOrder: z.number().int().min(0).max(999).default(0),
        required: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document } = await assertDocumentAccess(ctx, input.documentId);
      await assertPartyRosterOpen(ctx, document.id);

      const data = {
        role: input.role,
        displayName: input.displayName,
        email: input.email ?? null,
        signingOrder: input.signingOrder,
        required: input.required,
      };

      if (input.partyId) {
        const existing = await ctx.db.contractParty.findUnique({
          where: { id: input.partyId },
        });
        if (!existing || existing.documentId !== document.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Party not found",
          });
        }
        return ctx.db.contractParty.update({
          where: { id: input.partyId },
          data,
        });
      }

      return ctx.db.contractParty.create({
        data: { ...data, documentId: document.id },
      });
    }),

  /** Remove a party. Refused once they have signed — see the NoAction FK. */
  deleteContractParty: protectedProcedure
    .input(z.object({ partyId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const party = await ctx.db.contractParty.findUnique({
        where: { id: input.partyId },
      });
      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }
      await assertDocumentAccess(ctx, party.documentId);
      await assertPartyRosterOpen(ctx, party.documentId);

      const signed = await ctx.db.documentReview.count({
        where: { partyId: party.id },
      });
      if (signed > 0) {
        // The database would refuse this anyway (NoAction), but a foreign key
        // error is not an explanation.
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This party has already signed. Their signature is evidence and " +
            "cannot be removed by deleting them.",
        });
      }

      await ctx.db.contractParty.delete({ where: { id: party.id } });
      return { deleted: true };
    }),

  /**
   * Mint a single-use invite for a party and return the raw token ONCE.
   *
   * Only the sha256 is stored, so this response is the only time the token
   * exists anywhere retrievable — the same shape as every other credential in
   * this schema. Re-issuing replaces the previous token, which is what makes a
   * mistyped email recoverable.
   */
  issuePartyInvite: protectedProcedure
    .input(
      z.object({
        partyId: z.string().min(1),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 30)
          .default(24 * 14),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const party = await ctx.db.contractParty.findUnique({
        where: { id: input.partyId },
      });
      if (!party) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      }
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        party.documentId,
      );

      if (party.inviteConsumedAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This party has already redeemed an invite and is bound to an " +
            "address. Remove and re-add them to invite someone else.",
        });
      }

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + input.expiresInHours * 60 * 60 * 1000,
      );

      await ctx.db.contractParty.update({
        where: { id: party.id },
        data: {
          inviteTokenHash: sha256Hex(token),
          invitedAt: new Date(),
          inviteExpiresAt: expiresAt,
        },
      });

      await audit(ctx.db, {
        actorAddress: actingAddress(addresses),
        actorType: "user",
        action: "contract.party.invited",
        resourceType: "document",
        resourceId: document.id,
        outcome: "success",
        metadata: { partyId: party.id, role: party.role, expiresAt },
      });

      // The only time this value is returnable.
      return { token, expiresAt };
    }),

  /**
   * Redeem an invite: bind the caller's wallet address to the party.
   *
   * The caller authenticates with their OWN wallet through the ordinary session
   * flow — they are a real, signed-in user who simply is not a member of this
   * wallet. That is the whole point: it is what lets an outside counterparty
   * reach a contract without being given access to a treasury.
   */
  redeemPartyInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const addresses = getSessionAddresses(ctx);
      if (addresses.length === 0) throw new TRPCError({ code: "UNAUTHORIZED" });
      const address = actingAddress(addresses);

      const party = await ctx.db.contractParty.findUnique({
        where: { inviteTokenHash: sha256Hex(input.token) },
      });

      // One message for every failure. Distinguishing "no such invite" from
      // "already used" turns this into an oracle for guessing tokens.
      const reject = () => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite is not valid. Ask for a fresh link.",
        });
      };
      if (!party || party.inviteConsumedAt) reject();
      if (party!.inviteExpiresAt && party!.inviteExpiresAt < new Date())
        reject();

      // Conditional update, not read-then-write: two clicks on the same link
      // must not both bind, and the second must lose rather than overwrite.
      const claimed = await ctx.db.contractParty.updateMany({
        where: { id: party!.id, inviteConsumedAt: null },
        data: { address, inviteConsumedAt: new Date() },
      });
      if (claimed.count !== 1) reject();

      await audit(ctx.db, {
        actorAddress: address,
        actorType: "user",
        action: "contract.party.redeemed",
        resourceType: "document",
        resourceId: party!.documentId,
        outcome: "success",
        metadata: { partyId: party!.id, role: party!.role },
      });

      return { documentId: party!.documentId, role: party!.role };
    }),

  // -------------------------------------------------------------------------
  // v1 — Revision Provenance: diff, rollback, audit export
  // -------------------------------------------------------------------------

  /**
   * Compare two versions of one document.
   *
   * Party-aware like `getById`: anyone who may read the document may compare
   * its versions. The metadata diff always works; the line diff needs both
   * versions' bytes inline and readable as text, and says why when it cannot
   * run (see src/lib/documents/diff.ts).
   */
  diffVersions: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        fromVersionId: z.string().min(1),
        toVersionId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { document } = await resolveDocumentAccess(ctx, input.documentId);
      const versions = await ctx.db.documentVersion.findMany({
        where: {
          documentId: document.id,
          id: { in: [input.fromVersionId, input.toVersionId] },
        },
      });
      const from = versions.find((v) => v.id === input.fromVersionId);
      const to = versions.find((v) => v.id === input.toVersionId);
      if (!from || !to) {
        // Same answer whether the version does not exist or belongs to another
        // document, so this cannot be used to probe ids across documents.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found on this document",
        });
      }
      return diffVersions(from, to);
    }),

  /**
   * Roll back to an earlier version — by re-publishing it, never by rewriting.
   *
   * Creates version N+1 carrying the chosen version's exact content (same hash,
   * same bytes or reference), supersedes the current head, and starts it at
   * zero approvals like any other new version. The old version's approvals do
   * not come back: they were given in a round over a different history, and
   * the snapshot that counted them may no longer match the wallet. Signers
   * approve the restored content again.
   *
   * Append-only: the versions in between stay, the event log records
   * `version.restored` with the source, and the attestation chain gains a link
   * — so "we went back to v2" is itself part of the audited record.
   *
   * Wallet members only, like `uploadVersion`; a contract party can read and
   * sign but not change which content is up for signature.
   */
  restoreVersion: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        versionId: z.string().min(1),
        reviewInstructions: z.string().max(5000).optional(),
        /**
         * The head the caller was looking at. If someone else published or
         * restored in the meantime, the restore is refused rather than
         * silently superseding a version the caller never saw.
         */
        expectedHeadVersionId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      if (document.status === "Archived") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Document is archived",
        });
      }
      const actor = actingAddress(addresses);

      const source = await ctx.db.documentVersion.findFirst({
        where: { id: input.versionId, documentId: document.id },
      });
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Version not found on this document",
        });
      }

      const restored = await ctx.db
        .$transaction(async (tx) => {
          const head = await tx.documentVersion.findFirst({
            where: { documentId: document.id },
            orderBy: { versionNumber: "desc" },
          });
          if (
            input.expectedHeadVersionId &&
            head?.id !== input.expectedHeadVersionId
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This document has a newer version than the one you were looking " +
                "at. Reload before restoring.",
            });
          }
          // Compared by content, not id: re-publishing the bytes that are
          // already current would only discard the head's review round.
          if (head && head.contentHash === source.contentHash) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                head.id === source.id
                  ? `v${source.versionNumber} is already the current version`
                  : `The current version (v${head.versionNumber}) already has ` +
                    `v${source.versionNumber}'s content`,
            });
          }

          return appendVersion(tx, {
            document,
            actor,
            eventType: "version.restored",
            eventMetadata: {
              restoredFromVersionId: source.id,
              restoredFromVersionNumber: source.versionNumber,
              ...(head ? { replacedVersionNumber: head.versionNumber } : {}),
            },
            row: {
              contentHash: source.contentHash,
              fileName: source.fileName ?? undefined,
              mimeType: source.mimeType ?? undefined,
              fileSize: source.fileSize ?? undefined,
              storageMode: source.storageMode,
              contentRef: source.contentRef ?? undefined,
              contentInline: source.contentInline ?? undefined,
              reviewInstructions:
                input.reviewInstructions ??
                source.reviewInstructions ??
                undefined,
            },
          });
        })
        .catch((error: unknown) => {
          // Two writers racing for the same version number (or attestation
          // sequence) — the unique constraint picked a winner. Say so.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Someone else changed this document at the same moment. Reload and try again.",
            });
          }
          throw error;
        });

      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "document.version.restore",
        resourceType: "document",
        resourceId: document.id,
        outcome: "success",
        metadata: {
          restoredFromVersionNumber: source.versionNumber,
          newVersionNumber: restored.versionNumber,
        },
      });

      return restored;
    }),

  /**
   * The full audit package for a document: every version with its lineage and
   * proof, the whole event log, and the attestation chain with its keys. A
   * mutation, like `exportProof`, because exporting is itself logged.
   *
   * Wallet members only. A party's view is scoped to what they sign; the audit
   * bundle carries every round, including ones they were never part of.
   */
  exportAudit: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<AuditPackage> => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      const actor = actingAddress(addresses);

      // One snapshot: a version, event or attestation written between separate
      // reads would make an honest export fail its own verification.
      const [versions, events, attestations] = await ctx.db.$transaction(
        (tx) =>
          Promise.all([
            tx.documentVersion.findMany({
              where: { documentId: document.id },
              orderBy: { versionNumber: "asc" },
              omit: { contentInline: true },
              include: {
                signerSnapshot: true,
                reviews: {
                  orderBy: { signedAt: "asc" },
                  include: { party: { select: { role: true } } },
                },
              },
            }),
            tx.documentEvent.findMany({
              where: { documentId: document.id },
              orderBy: { createdAt: "asc" },
            }),
            tx.documentAttestation.findMany({
              where: { documentId: document.id },
              orderBy: { sequence: "asc" },
            }),
          ]),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      const pkg = buildAuditPackage({
        document,
        versions,
        events,
        attestations,
        publicKeys: getAttestationPublicKeys(),
        exportedAt: new Date(),
      });

      await ctx.db.documentEvent.create({
        data: {
          documentId: document.id,
          type: "audit.exported",
          actorAddress: actor,
          metadata: {
            versionCount: pkg.versions.length,
            eventCount: pkg.events.length,
            attested: pkg.attestation !== null,
          },
        },
      });

      return pkg;
    }),

  /**
   * Verify an audit package. Public and database-free, like `verifyProof`:
   * it re-runs the maths in src/lib/documents/audit.ts and nothing else.
   * Checks the chain against this deployment's published keys unless the
   * caller supplies their own.
   */
  verifyAudit: publicProcedure
    .input(
      z.object({
        audit: z.unknown(),
        publicKeys: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const problem = auditPackageProblem(input.audit);
      if (problem !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      }
      // No keys configured here means nothing of ours to check against; fall
      // back to the package's own keys, which the result then flags.
      const ours = getAttestationPublicKeys();
      const publicKeys =
        input.publicKeys ?? (Object.keys(ours).length > 0 ? ours : undefined);
      try {
        return await verifyAuditPackage(input.audit as AuditPackage, {
          checkSignature,
          publicKeys,
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That audit package could not be verified — it is malformed.",
        });
      }
    }),

  /** Archive a document — history is retained, it just leaves active use. */
  archiveDocument: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { document, addresses } = await assertDocumentAccess(
        ctx,
        input.documentId,
      );
      const actor = actingAddress(addresses);
      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.document.update({
          where: { id: document.id },
          data: { status: "Archived", archivedAt: new Date() },
        });
        await tx.documentEvent.create({
          data: {
            documentId: document.id,
            type: "document.archived",
            actorAddress: actor,
          },
        });
        return updated;
      });
    }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type VersionRowInput = {
  documentId: string;
  versionNumber: number;
  createdBy: string;
  contentHash: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  storageMode: "hashOnly" | "inline" | "external";
  contentRef?: string;
  contentInline?: string;
  reviewInstructions?: string;
};

/**
 * Creates the version row, and — when the bytes are actually supplied —
 * re-hashes them server-side. A client-declared hash that does not match the
 * bytes it shipped is a version-drift bug or an attack; either way it must
 * never reach the signers.
 */
/**
 * Attest a newly created version: a signed timestamp-and-ordering record,
 * linked to the previous attestation for this document.
 *
 * Explicitly NOT an approval — see src/lib/documents/attestation.ts. The
 * platform key witnesses that a version existed at a time and in a position;
 * enactment still requires CIP-8 signatures from the wallet's own signers.
 *
 * Runs inside the caller's transaction, on purpose. When a key is configured,
 * every version gets an attestation or the version is not created at all: a
 * silently unattested version would make the audit trail lie by omission, which
 * is worse than a failed upload. When no key is configured this is a no-op and
 * the rest of the feature behaves exactly as before.
 *
 * Concurrency is handled by @@unique([documentId, sequence]): two simultaneous
 * uploads cannot both claim the same link, so one rolls back rather than
 * forking the chain — the same way @@unique([documentId, versionNumber])
 * already guards version numbers.
 */
async function attestVersion(
  tx: Prisma.TransactionClient,
  version: {
    id: string;
    documentId: string;
    versionNumber: number;
    contentHash: string;
  },
  walletId: string,
) {
  const signer = getAttestationSigner();
  if (!signer) return;

  const previous = await tx.documentAttestation.findFirst({
    where: { documentId: version.documentId },
    orderBy: { sequence: "desc" },
  });

  const payload = buildAttestationPayload({
    attestedAt: new Date(),
    contentHash: version.contentHash,
    documentId: version.documentId,
    prevAttestationHash: previous?.attestationHash ?? GENESIS_PREV,
    sequence: (previous?.sequence ?? 0) + 1,
    versionId: version.id,
    versionNumber: version.versionNumber,
    walletId,
  });

  await tx.documentAttestation.create({
    data: {
      versionId: version.id,
      documentId: version.documentId,
      sequence: payload.sequence,
      contentHash: payload.contentHash,
      prevAttestationHash: payload.prevAttestationHash,
      attestationHash: attestationHash(payload),
      payload: canonicalizeAttestation(payload),
      signature: signer.sign(payload),
      publicKeyId: signer.keyId,
      attestedAt: new Date(payload.attestedAt),
    },
  });
}

type AppendVersionRow = Omit<
  VersionRowInput,
  "documentId" | "versionNumber" | "createdBy"
>;

/**
 * Append the next version to a document — the only way a version is created
 * after the first.
 *
 * Supersedes the current head (approvals never carry forward), creates the row,
 * logs the creating event, attests the new version and returns the document to
 * Draft, all in the caller's transaction. Upload, publish-from-draft and
 * restore differ only in where the bytes come from and which event names the
 * origin, so they share this rather than three copies of the supersede logic.
 *
 * Append-only by construction: nothing here edits or removes an existing
 * version, which is what lets a restore be a rollback without rewriting
 * history.
 */
async function appendVersion(
  tx: Prisma.TransactionClient,
  input: {
    document: { id: string; walletId: string };
    actor: string;
    eventType: "version.uploaded" | "version.published" | "version.restored";
    eventMetadata: Record<string, Prisma.InputJsonValue>;
    row: AppendVersionRow;
  },
) {
  const { document, actor } = input;
  const latest = await tx.documentVersion.findFirst({
    where: { documentId: document.id },
    orderBy: { versionNumber: "desc" },
  });

  if (
    latest &&
    latest.status !== "Superseded" &&
    latest.status !== "Archived"
  ) {
    await tx.documentVersion.update({
      where: { id: latest.id },
      data: { status: "Superseded", supersededAt: new Date() },
    });
    await tx.documentEvent.create({
      data: {
        documentId: document.id,
        versionId: latest.id,
        type: "version.superseded",
        actorAddress: actor,
        metadata: { versionNumber: latest.versionNumber },
      },
    });
  }

  const created = await createVersionRow(tx, {
    ...input.row,
    documentId: document.id,
    versionNumber: (latest?.versionNumber ?? 0) + 1,
    createdBy: actor,
  });

  await tx.documentEvent.create({
    data: {
      documentId: document.id,
      versionId: created.id,
      type: input.eventType,
      actorAddress: actor,
      metadata: {
        versionNumber: created.versionNumber,
        contentHash: created.contentHash,
        ...input.eventMetadata,
        approvalsReset: true,
      },
    },
  });

  await attestVersion(tx, created, document.walletId);

  await tx.document.update({
    where: { id: document.id },
    data: { status: "Draft" },
  });

  return created;
}

async function createVersionRow(
  tx: Prisma.TransactionClient,
  input: VersionRowInput,
) {
  if (input.storageMode === "inline") {
    if (!input.contentInline) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "storageMode 'inline' requires contentInline",
      });
    }
    const bytes = Buffer.from(input.contentInline, "base64");
    if (bytes.length > MAX_INLINE_BYTES) {
      throw new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: `Inline content exceeds ${MAX_INLINE_BYTES} bytes`,
      });
    }
    if (sha256Hex(bytes) !== input.contentHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "contentHash does not match the supplied bytes",
      });
    }
  }
  if (input.storageMode === "external" && !input.contentRef) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "storageMode 'external' requires contentRef",
    });
  }

  return tx.documentVersion.create({
    data: {
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      contentHash: input.contentHash,
      hashAlgorithm: "sha256",
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      fileSize: input.fileSize ?? null,
      storageMode: input.storageMode,
      contentRef: input.contentRef ?? null,
      contentInline:
        input.storageMode === "inline" ? input.contentInline : null,
      reviewInstructions: input.reviewInstructions ?? null,
      status: "Draft",
      createdBy: input.createdBy,
    },
  });
}
