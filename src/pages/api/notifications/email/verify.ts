import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { getSiteUrl } from "@/lib/notifications/center";
import { escapeHtml } from "@/lib/notifications/templates/shared";
import { db } from "@/server/db";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function walletSettingsUrl(walletId: string): string {
  return `${getSiteUrl()}/wallets/${encodeURIComponent(walletId)}/info`;
}

type VerifyPageOptions = {
  ctaHref?: string;
  ctaLabel?: string;
  secondaryMessage?: string;
};

function renderResult(
  title: string,
  message: string,
  options: VerifyPageOptions = {},
) {
  const cta =
    options.ctaHref && options.ctaLabel
      ? `<p style="margin:24px 0 0;">
          <a href="${escapeHtml(options.ctaHref)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;padding:12px 18px;font-weight:700;">
            ${escapeHtml(options.ctaLabel)}
          </a>
        </p>`
      : "";
  const secondary = options.secondaryMessage
    ? `<p style="margin:16px 0 0;color:#6b7280;font-size:14px;line-height:1.5;">${escapeHtml(options.secondaryMessage)}</p>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:560px;margin:48px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;">Mesh Multisig</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;">${escapeHtml(title)}</h1>
      <p style="margin:0;color:#374151;line-height:1.6;">${escapeHtml(message)}</p>
      ${cta}
      ${secondary}
    </main>
  </body>
</html>`;
}

function sendHtml(
  res: NextApiResponse,
  status: number,
  title: string,
  message: string,
  options: VerifyPageOptions = {},
) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(renderResult(title, message, options));
}

function walletReturnOptions(walletId: string): VerifyPageOptions {
  return {
    ctaHref: walletSettingsUrl(walletId),
    ctaLabel: "Go to wallet",
    secondaryMessage: "You can safely close this window.",
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      return sendHtml(
        res,
        400,
        "Invalid verification link",
        "The verification token is missing.",
      );
    }

    const tokenHash = hashToken(token);
    const verification = await db.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verification) {
      return sendHtml(
        res,
        404,
        "Invalid verification link",
        "This verification link was not found.",
      );
    }

    if (verification.consumedAt) {
      return sendHtml(
        res,
        200,
        "Email already verified",
        "This email verification link has already been used.",
        walletReturnOptions(verification.walletId),
      );
    }

    if (verification.expiresAt < new Date()) {
      return sendHtml(
        res,
        410,
        "Verification link expired",
        "Please request a new verification email from your wallet notification settings.",
        {
          ctaHref: walletSettingsUrl(verification.walletId),
          ctaLabel: "Go to wallet",
        },
      );
    }

    const setting = await db.walletSignerNotificationSetting.findUnique({
      where: {
        walletId_signerAddress: {
          walletId: verification.walletId,
          signerAddress: verification.signerAddress,
        },
      },
    });

    if (!setting || setting.emailNormalized !== verification.emailNormalized) {
      await db.emailVerificationToken.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
      return sendHtml(
        res,
        409,
        "Email changed",
        "This verification link no longer matches your current notification email.",
        {
          ctaHref: walletSettingsUrl(verification.walletId),
          ctaLabel: "Go to wallet",
        },
      );
    }

    await db.$transaction(async (tx) => {
      await tx.walletSignerNotificationSetting.update({
        where: { id: setting.id },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.emailVerificationToken.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
    });

    return sendHtml(
      res,
      200,
      "Email verified",
      "You can now receive email notifications for this wallet.",
      walletReturnOptions(verification.walletId),
    );
  } catch (error) {
    console.error("Email verification failed", error);
    return sendHtml(
      res,
      500,
      "Verification failed",
      "Something went wrong while verifying your email. Please try again or request a new verification email.",
    );
  }
}
