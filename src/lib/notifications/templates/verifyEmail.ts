import { escapeHtml, renderEmailLayout, type EmailTemplate } from "./shared";

export type VerifyEmailTemplateInput = {
  walletName: string;
  verifyUrl: string;
  preferencesUrl: string;
  expiresHours: number;
};

export function renderVerifyEmail(
  input: VerifyEmailTemplateInput,
): EmailTemplate {
  const subject = `Verify email notifications for ${input.walletName}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Confirm that this email address should receive notifications for <strong>${escapeHtml(input.walletName)}</strong>.</p>
    <p style="margin:0 0 16px;">This verification link expires in ${input.expiresHours} hours.</p>
  `;

  const html = renderEmailLayout({
    title: "Verify your notification email",
    preview: `Confirm email notifications for ${input.walletName}.`,
    bodyHtml,
    ctaLabel: "Verify email",
    ctaUrl: input.verifyUrl,
    footerHtml: `You can update wallet notification preferences here: <a href="${escapeHtml(input.preferencesUrl)}" style="color:#374151;">${escapeHtml(input.preferencesUrl)}</a>`,
  });

  const text = [
    subject,
    "",
    `Confirm that this email address should receive notifications for ${input.walletName}.`,
    `This verification link expires in ${input.expiresHours} hours.`,
    "",
    `Verify email: ${input.verifyUrl}`,
    `Manage notification preferences: ${input.preferencesUrl}`,
  ].join("\n");

  return { subject, html, text };
}
