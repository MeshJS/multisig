import { escapeHtml, renderEmailLayout, type EmailTemplate } from "./shared";
import type { SignatureContext } from "../signatureContext";

const DESCRIPTION_PREVIEW_MAX_LENGTH = 240;

export type SignatureRequiredTemplateInput = {
  walletName: string;
  resourceType: "transaction" | "signable";
  description?: string | null;
  signedCount: number;
  requiredCount: number;
  totalSigners: number;
  actionUrl: string;
  preferencesUrl: string;
  signatureContext?: SignatureContext | null;
};

function truncateDescription(description: string): string {
  if (description.length <= DESCRIPTION_PREVIEW_MAX_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

export function renderSignatureRequiredEmail(
  input: SignatureRequiredTemplateInput,
): EmailTemplate {
  const resourceLabel =
    input.resourceType === "transaction" ? "transaction" : "signable payload";
  const subject = `Signature required: ${input.walletName}`;
  const progress = `${input.signedCount} of ${input.requiredCount} required signatures collected`;
  const description = input.description?.trim();
  const descriptionPreview = description
    ? truncateDescription(description)
    : undefined;
  const context = input.signatureContext;
  const contextRows =
    context?.details
      ?.filter((detail) => detail.label.trim() && detail.value.trim())
      .map(
        (detail) => `
      <tr>
        <td style="padding:12px 14px;border-top:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(detail.label)}</td>
        <td style="padding:12px 14px;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(detail.value)}</td>
      </tr>`,
      )
      .join("") ?? "";

  const bodyHtml = `
    <p style="margin:0 0 16px;">A ${escapeHtml(resourceLabel)} in <strong>${escapeHtml(input.walletName)}</strong> is waiting for your signature.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #e5e7eb;border-radius:6px;">
      ${
        descriptionPreview
          ? `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Description</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escapeHtml(descriptionPreview)}</td>
      </tr>`
          : ""
      }
      ${
        context?.summary
          ? `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;">What needs signing</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escapeHtml(context.summary)}</td>
      </tr>`
          : ""
      }
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Progress</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escapeHtml(progress)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;color:#6b7280;">Signers</td>
        <td style="padding:12px 14px;text-align:right;">${input.totalSigners}</td>
      </tr>
      ${contextRows}
    </table>
  `;

  const html = renderEmailLayout({
    title: "Your signature is required",
    preview: `${input.walletName} has a ${resourceLabel} awaiting your signature.`,
    bodyHtml,
    ctaLabel: "Review and sign",
    ctaUrl: input.actionUrl,
    footerHtml: `Manage wallet notification preferences here: <a href="${escapeHtml(input.preferencesUrl)}" style="color:#374151;">${escapeHtml(input.preferencesUrl)}</a>`,
  });

  const text = [
    subject,
    "",
    `A ${resourceLabel} in ${input.walletName} is waiting for your signature.`,
    descriptionPreview ? `Description: ${descriptionPreview}` : undefined,
    context?.summary ? `What needs signing: ${context.summary}` : undefined,
    ...(context?.details?.map((detail) => `${detail.label}: ${detail.value}`) ?? []),
    progress,
    `Total signers: ${input.totalSigners}`,
    "",
    `Review and sign: ${input.actionUrl}`,
    `Manage notification preferences: ${input.preferencesUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
