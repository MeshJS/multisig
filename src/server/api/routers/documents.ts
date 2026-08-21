/**
 * Document Sign-Off (PRD-001) — tRPC router.
 *
 * Six operations: createDocument, uploadVersion, startReview,
 * submitSignerAction, exportProof, verifyProof — plus the reads the four
 * Documents pages need.
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
import { audit } from "@/lib/observability/audit";
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
  PROOF_FORMAT,
  VERIFICATION_INSTRUCTIONS,
  verifyProofPackage,
  type ProofPackage,
} from "@/lib/documents/proof";
import { SIGNOFF_DOMAIN } from "@/lib/documents/payload";

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
      const { document } = await assertDocumentAccess(ctx, input.documentId);
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

      const version = await ctx.db.$transaction(async (tx) => {
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
          documentId: document.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          createdBy: actor,
          contentHash: input.contentHash,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          storageMode: input.storageMode,
          contentRef: input.contentRef,
          contentInline: input.contentInline,
          reviewInstructions: input.reviewInstructions,
        });

        await tx.documentEvent.create({
          data: {
            documentId: document.id,
            versionId: created.id,
            type: "version.uploaded",
            actorAddress: actor,
            metadata: {
              versionNumber: created.versionNumber,
              contentHash: created.contentHash,
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
      });

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
          reviews: { orderBy: { signedAt: "asc" } },
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

      const descriptionFor = (address: string): string | null => {
        const idx = snapshot.signersAddresses.indexOf(address);
        return idx >= 0 ? (snapshot.signersDescriptions[idx] ?? null) : null;
      };

      const pkg: ProofPackage = {
        format: PROOF_FORMAT,
        exportedAt: new Date().toISOString(),
        document: {
          id: version.document.id,
          walletId: version.document.walletId,
          title: version.document.title,
          description: version.document.description,
          documentType: version.document.documentType,
          createdBy: version.document.createdBy,
          createdAt: version.document.createdAt.toISOString(),
        },
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          contentHash: version.contentHash,
          hashAlgorithm: version.hashAlgorithm,
          fileName: version.fileName,
          mimeType: version.mimeType,
          fileSize: version.fileSize,
          status: version.status,
          createdBy: version.createdBy,
          createdAt: version.createdAt.toISOString(),
          reviewStartedAt: version.reviewStartedAt?.toISOString() ?? null,
          decidedAt: version.decidedAt?.toISOString() ?? null,
        },
        policy: {
          walletId: snapshot.walletId,
          walletPolicyHash: snapshot.walletPolicyHash,
          requiredSigners: snapshot.requiredSigners,
          signersAddresses: snapshot.signersAddresses,
          signersDescriptions: snapshot.signersDescriptions,
          capturedAt: snapshot.capturedAt.toISOString(),
        },
        reviews: version.reviews.map((r) => ({
          signerAddress: r.signerAddress,
          signerDescription: descriptionFor(r.signerAddress),
          action: r.action,
          comment: r.comment,
          payload: r.payload,
          signature: r.signature,
          signatureKey: r.signatureKey,
          signedAt: r.signedAt.toISOString(),
        })),
        events: version.document.events
          .filter((e) => e.versionId === null || e.versionId === version.id)
          .map((e) => ({
            type: e.type,
            actorAddress: e.actorAddress,
            createdAt: e.createdAt.toISOString(),
            metadata: e.metadata,
          })),
        verification: {
          domain: SIGNOFF_DOMAIN,
          instructions: VERIFICATION_INSTRUCTIONS,
        },
      };

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
      const pkg = input.proof as ProofPackage;
      if (!pkg || typeof pkg !== "object" || !pkg.version || !pkg.policy) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a Document Sign-Off proof package",
        });
      }
      return verifyProofPackage(pkg, {
        expectedContentHash: input.expectedContentHash,
        checkSignature,
      });
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
        chain: z.array(
          z.object({
            payload: z.unknown(),
            signature: z.string(),
            publicKeyId: z.string(),
          }),
        ),
        /** Omit to check against the keys this deployment publishes. */
        publicKeys: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(({ input }) =>
      verifyAttestationChain(
        input.chain as AttestationRecord[],
        input.publicKeys ?? getAttestationPublicKeys(),
      ),
    ),

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
