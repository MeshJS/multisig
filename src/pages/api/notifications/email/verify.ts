import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function renderResult(title: string, message: string) {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:560px;margin:48px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;">Mesh Multisig</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;">${title}</h1>
      <p style="margin:0;color:#374151;line-height:1.6;">${message}</p>
    </main>
  </body>
</html>`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    return res
      .status(400)
      .send(renderResult("Invalid verification link", "The verification token is missing."));
  }

  const tokenHash = hashToken(token);
  const verification = await db.emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!verification) {
    return res
      .status(404)
      .send(renderResult("Invalid verification link", "This verification link was not found."));
  }

  if (verification.consumedAt) {
    return res
      .status(200)
      .send(renderResult("Email already verified", "This email verification link has already been used."));
  }

  if (verification.expiresAt < new Date()) {
    return res
      .status(410)
      .send(renderResult("Verification link expired", "Please request a new verification email from your wallet notification settings."));
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
    return res
      .status(409)
      .send(renderResult("Email changed", "This verification link no longer matches your current notification email."));
  }

  await db.$transaction([
    db.walletSignerNotificationSetting.update({
      where: { id: setting.id },
      data: { emailVerifiedAt: new Date() },
    }),
    db.emailVerificationToken.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  return res
    .status(200)
    .send(renderResult("Email verified", "You can now receive email notifications for this wallet."));
}
