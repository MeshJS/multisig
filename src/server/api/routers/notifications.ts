import { createHash, randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";
import { assertWalletAccess } from "@/server/api/auth";
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";
import {
  getSiteUrl,
  enqueueSignatureRequiredNotifications,
  notificationsEmailEnabled,
} from "@/lib/notifications/center";
import {
  NOTIFICATION_EVENT_EMAIL_VERIFY,
  NOTIFICATION_EVENT_SIGNATURE_REMINDER,
} from "@/lib/notifications/events";
import { createNotificationDelivery } from "@/lib/notifications/outbox";
import { normalizeEmail } from "@/lib/notifications/recipients";
import { summarizeSignableSignatureContext } from "@/lib/notifications/signatureContext";
import { renderVerifyEmail } from "@/lib/notifications/templates/verifyEmail";
import { drainNotificationOutbox } from "@/lib/notifications/worker";

const VERIFY_TOKEN_BYTES = 32;
const VERIFY_TOKEN_TTL_HOURS = 24;

function addressesEqual(a: string, b: string): boolean {
  return normalizeAddressToBech32(a) === normalizeAddressToBech32(b);
}

function isAddressAuthorizedInSession(ctx: AuthCtx, address: string): boolean {
  const normalized = normalizeAddressToBech32(address);
  const sessionWallets = Array.isArray(ctx.sessionWallets)
    ? ctx.sessionWallets
    : [];
  if (sessionWallets.some((candidate) => addressesEqual(candidate, normalized))) {
    return true;
  }
  const primary = ctx.primaryWallet ?? ctx.sessionAddress;
  if (primary && addressesEqual(primary, normalized)) {
    return true;
  }
  const sessionUserId = ctx.session?.user?.id;
  return Boolean(sessionUserId && addressesEqual(sessionUserId, normalized));
}

function requireAuthorizedSignerAddress(
  ctx: AuthCtx,
  requesterAddress: string,
): string {
  const normalized = normalizeAddressToBech32(requesterAddress.trim());
  if (!normalized) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing signer address",
    });
  }
  if (!isAddressAuthorizedInSession(ctx, normalized)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Address mismatch. Please authorize your currently connected wallet.",
    });
  }
  return normalized;
}

function resolveWalletSignerAddress(
  signersAddresses: string[],
  requesterAddress: string,
): string {
  const normalized = normalizeAddressToBech32(requesterAddress);
  return (
    signersAddresses.find((candidate) => addressesEqual(candidate, normalized)) ??
    normalized
  );
}

function isWalletSigner(signersAddresses: string[], address: string): boolean {
  return signersAddresses.some((candidate) => addressesEqual(candidate, address));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function assertCurrentSigner(
  ctx: AuthCtx,
  walletId: string,
  requesterAddress: string,
) {
  requireAuthorizedSignerAddress(ctx, requesterAddress);
  const wallet = await assertWalletAccess(ctx, walletId, requesterAddress);
  const signerAddress = resolveWalletSignerAddress(
    wallet.signersAddresses,
    requesterAddress,
  );
  if (!isWalletSigner(wallet.signersAddresses, signerAddress)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a wallet signer can manage their notification settings",
    });
  }
  return { wallet, signerAddress };
}

function verificationUrl(token: string): string {
  return `${getSiteUrl()}/api/notifications/email/verify?token=${encodeURIComponent(token)}`;
}

export const notificationRouter = createTRPCRouter({
  getWalletSignerSetting: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        signerAddress: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { signerAddress } = await assertCurrentSigner(
        ctx,
        input.walletId,
        input.signerAddress,
      );
      const setting = await ctx.db.walletSignerNotificationSetting.findUnique({
        where: {
          walletId_signerAddress: {
            walletId: input.walletId,
            signerAddress,
          },
        },
      });

      return (
        setting ?? {
          id: null,
          walletId: input.walletId,
          signerAddress,
          email: null,
          emailNormalized: null,
          emailVerifiedAt: null,
          emailOptIn: true,
          notifyTransactionSignatures: true,
          notifySignableSignatures: true,
          createdAt: null,
          updatedAt: null,
        }
      );
    }),

  upsertWalletSignerSetting: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        signerAddress: z.string().min(1),
        email: z.string().email().or(z.literal("")).optional(),
        emailOptIn: z.boolean().optional(),
        notifyTransactionSignatures: z.boolean().optional(),
        notifySignableSignatures: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { signerAddress } = await assertCurrentSigner(
        ctx,
        input.walletId,
        input.signerAddress,
      );
      const existing = await ctx.db.walletSignerNotificationSetting.findUnique({
        where: {
          walletId_signerAddress: {
            walletId: input.walletId,
            signerAddress,
          },
        },
      });

      const emailProvided = Object.prototype.hasOwnProperty.call(input, "email");
      const email = emailProvided && input.email ? input.email.trim() : null;
      const emailNormalized = email ? normalizeEmail(email) : null;
      const emailChanged =
        emailProvided && existing?.emailNormalized !== emailNormalized;

      const data = {
        ...(emailProvided
          ? {
              email,
              emailNormalized,
              emailVerifiedAt: emailChanged ? null : existing?.emailVerifiedAt,
            }
          : {}),
        ...(typeof input.emailOptIn === "boolean"
          ? { emailOptIn: input.emailOptIn }
          : {}),
        ...(typeof input.notifyTransactionSignatures === "boolean"
          ? {
              notifyTransactionSignatures:
                input.notifyTransactionSignatures,
            }
          : {}),
        ...(typeof input.notifySignableSignatures === "boolean"
          ? { notifySignableSignatures: input.notifySignableSignatures }
          : {}),
      };

      const setting = await ctx.db.walletSignerNotificationSetting.upsert({
        where: {
          walletId_signerAddress: {
            walletId: input.walletId,
            signerAddress,
          },
        },
        update: data,
        create: {
          walletId: input.walletId,
          signerAddress,
          email,
          emailNormalized,
          emailVerifiedAt: null,
          emailOptIn: input.emailOptIn ?? true,
          notifyTransactionSignatures:
            input.notifyTransactionSignatures ?? true,
          notifySignableSignatures: input.notifySignableSignatures ?? true,
        },
      });

      if (emailChanged) {
        await ctx.db.emailVerificationToken.updateMany({
          where: {
            walletId: input.walletId,
            signerAddress,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        });
      }

      return setting;
    }),

  sendVerificationEmail: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        signerAddress: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { wallet, signerAddress } = await assertCurrentSigner(
        ctx,
        input.walletId,
        input.signerAddress,
      );
      const setting = await ctx.db.walletSignerNotificationSetting.findUnique({
        where: {
          walletId_signerAddress: {
            walletId: input.walletId,
            signerAddress,
          },
        },
      });

      if (!setting?.email || !setting.emailNormalized) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an email address before sending verification",
        });
      }

      const token = randomBytes(VERIFY_TOKEN_BYTES).toString("base64url");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(
        Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000,
      );

      await ctx.db.emailVerificationToken.create({
        data: {
          walletId: input.walletId,
          signerAddress,
          emailNormalized: setting.emailNormalized,
          tokenHash,
          expiresAt,
        },
      });

      const preferencesUrl = `${getSiteUrl()}/wallets/${input.walletId}/info`;
      const template = renderVerifyEmail({
        walletName: wallet.name,
        verifyUrl: verificationUrl(token),
        preferencesUrl,
        expiresHours: VERIFY_TOKEN_TTL_HOURS,
      });

      const delivery = await createNotificationDelivery(ctx.db, {
        eventType: NOTIFICATION_EVENT_EMAIL_VERIFY,
        recipientAddress: signerAddress,
        recipientEmail: setting.email,
        resourceType: "wallet",
        resourceId: input.walletId,
        walletId: input.walletId,
        idempotencyKey: [
          NOTIFICATION_EVENT_EMAIL_VERIFY,
          "email",
          input.walletId,
          signerAddress,
          tokenHash,
        ].join(":"),
        subject: template.subject,
        payload: {
          walletId: input.walletId,
          walletName: wallet.name,
          signerAddress,
          html: template.html,
          text: template.text,
        },
      });

      if (notificationsEmailEnabled()) {
        try {
          await drainNotificationOutbox(ctx.db, { limit: 10 });
        } catch (error) {
          console.error("Verification email drain failed", error);
        }
      }

      return {
        deliveryId: delivery.id,
        emailEnabled: env.NOTIFICATIONS_EMAIL_ENABLED === "true",
      };
    }),

  sendSignatureReminder: protectedProcedure
    .input(
      z.object({
        walletId: z.string().min(1),
        resourceType: z.enum(["transaction", "signable"]),
        resourceId: z.string().min(1),
        recipientAddress: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wallet = await assertWalletAccess(ctx, input.walletId);
      if (!wallet.signersAddresses.includes(input.recipientAddress)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Recipient is not a wallet signer",
        });
      }

      if (input.resourceType === "transaction") {
        const transaction = await ctx.db.transaction.findUnique({
          where: { id: input.resourceId },
        });
        if (!transaction || transaction.walletId !== input.walletId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }
        if (
          transaction.state !== 0 ||
          transaction.signedAddresses.includes(input.recipientAddress) ||
          transaction.rejectedAddresses.includes(input.recipientAddress)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Recipient does not need to sign this transaction",
          });
        }
        return enqueueSignatureRequiredNotifications(ctx.db, {
          wallet,
          resourceType: "transaction",
          resourceId: transaction.id,
          signedAddresses: transaction.signedAddresses,
          rejectedAddresses: transaction.rejectedAddresses,
          description: transaction.description,
          txJson: transaction.txJson,
          onlyRecipientAddress: input.recipientAddress,
          eventType: NOTIFICATION_EVENT_SIGNATURE_REMINDER,
        });
      }

      const signable = await ctx.db.signable.findUnique({
        where: { id: input.resourceId },
      });
      if (!signable || signable.walletId !== input.walletId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Signable not found",
        });
      }
      if (
        signable.state !== 0 ||
        signable.signedAddresses.includes(input.recipientAddress) ||
        signable.rejectedAddresses.includes(input.recipientAddress)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Recipient does not need to sign this payload",
        });
      }
      return enqueueSignatureRequiredNotifications(ctx.db, {
        wallet,
        resourceType: "signable",
        resourceId: signable.id,
        signedAddresses: signable.signedAddresses,
        rejectedAddresses: signable.rejectedAddresses,
        description: signable.description,
        signatureContext: summarizeSignableSignatureContext({
          method: signable.method,
          description: signable.description,
        }),
        onlyRecipientAddress: input.recipientAddress,
        eventType: NOTIFICATION_EVENT_SIGNATURE_REMINDER,
      });
    }),
});
