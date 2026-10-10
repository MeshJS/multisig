import { escapeHtml, renderEmailLayout, type EmailTemplate } from "./shared";
import type { SignatureContext } from "../signatureContext";

const DESCRIPTION_PREVIEW_MAX_LENGTH = 240;

export type ThresholdReachedTemplateInput = {
  walletName: string;
  resourceType: "transaction" | "signable";
  description?: string | null;
  signatureContext?: SignatureContext | null;
  signedCount: number;
  requiredCount: number;
  totalSigners: number;
  /** Present when the transaction was broadcast as part of the final signature. */
  txHash?: string | null;
  actionUrl: string;
  preferencesUrl: string;
};

function truncateDescription(description: string): string {
  if (description.length <= DESCRIPTION_PREVIEW_MAX_LENGTH) {
    return description;
  }
  return `${description.slice(0, DESCRIPTION_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

function row(label: string, value: string, bold = false, last = false) {
  const border = last ? "" : "border-bottom:1px solid #e5e7eb;";
  return `
      <tr>
        <td style="padding:12px 14px;${border}color:#6b7280;">${escapeHtml(label)}</td>
        <td style="padding:12px 14px;${border}text-align:right;${bold ? "font-weight:700;" : ""}">${escapeHtml(value)}</td>
      </tr>`;
}

export function renderThresholdReachedEmail(
  input: ThresholdReachedTemplateInput,
): EmailTemplate {
  const resourceLabel =
    input.resourceType === "transaction" ? "transaction" : "signable payload";
  const subject = `Signatures complete: ${input.walletName}`;
  const progress = `${input.signedCount} of ${input.requiredCount} required signatures collected`;
  const description = input.description?.trim();
  const descriptionPreview = description
    ? truncateDescription(description)
    : undefined;
  const context = input.signatureContext;
  const txHash = input.txHash?.trim() || null;

  const statusLine =
    input.resourceType === "transaction"
      ? txHash
        ? "Submitted to the network."
        : "Ready to submit — open the wallet to broadcast it."
      : "All required signatures have been collected.";

  const rows = [
    descriptionPreview ? row("Description", descriptionPreview, true) : "",
    context?.summary ? row("What was signed", context.summary, true) : "",
    row("Progress", progress, true),
    row("Status", statusLine, false, !txHash && input.totalSigners <= 0),
    txHash ? row("Transaction hash", txHash) : "",
    row("Signers", String(input.totalSigners), false, true),
    ...(context?.details
      ?.filter((detail) => detail.label.trim() && detail.value.trim())
      .map(
        (detail) => `
      <tr>
        <td style="padding:12px 14px;border-top:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(detail.label)}</td>
        <td style="padding:12px 14px;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(detail.value)}</td>
      </tr>`,
      ) ?? []),
  ].join("");

  const bodyHtml = `
    <p style="margin:0 0 16px;">A ${escapeHtml(resourceLabel)} in <strong>${escapeHtml(input.walletName)}</strong> has collected enough signatures. ${escapeHtml(statusLine)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #e5e7eb;border-radius:6px;">
      ${rows}
    </table>
  `;

  const html = renderEmailLayout({
    title: "Signatures complete",
    preview: `${input.walletName}: a ${resourceLabel} has all required signatures.`,
    bodyHtml,
    ctaLabel: txHash ? "View transaction" : "Open wallet",
    ctaUrl: input.actionUrl,
    footerHtml: `Manage wallet notification preferences here: <a href="${escapeHtml(input.preferencesUrl)}" style="color:#374151;">${escapeHtml(input.preferencesUrl)}</a>`,
  });

  const text = [
    subject,
    "",
    `A ${resourceLabel} in ${input.walletName} has collected enough signatures.`,
    statusLine,
    descriptionPreview ? `Description: ${descriptionPreview}` : undefined,
    context?.summary ? `What was signed: ${context.summary}` : undefined,
    ...(context?.details?.map((detail) => `${detail.label}: ${detail.value}`) ?? []),
    progress,
    txHash ? `Transaction hash: ${txHash}` : undefined,
    `Total signers: ${input.totalSigners}`,
    "",
    `${txHash ? "View transaction" : "Open wallet"}: ${input.actionUrl}`,
    `Manage notification preferences: ${input.preferencesUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
