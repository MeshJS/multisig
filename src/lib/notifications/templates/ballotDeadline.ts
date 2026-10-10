import { escapeHtml, renderEmailLayout, type EmailTemplate } from "./shared";

export type BallotDeadlineWindow = "48h" | "24h";

/** What the reminder is anchored on: a saved ballot or a pending vote transaction. */
export type BallotDeadlineKind = "ballot" | "transaction";

export type BallotDeadlineProposal = {
  id: string;
  title: string | null;
  expirationEpoch: number;
};

export type BallotDeadlineTemplateInput = {
  walletName: string;
  kind: BallotDeadlineKind;
  /** Ballot description, or the pending transaction's description. */
  label?: string | null;
  window: BallotDeadlineWindow;
  /** End of the earliest expiring proposal's final epoch. */
  deadline: Date;
  deadlineEpoch: number;
  proposals: BallotDeadlineProposal[];
  /** Signature progress of the pending vote transaction (transaction kind only). */
  signedCount?: number;
  requiredCount?: number;
  actionUrl: string;
  preferencesUrl: string;
};

const MAX_LISTED_PROPOSALS = 10;

function formatUtc(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function shortProposalId(id: string): string {
  const [hash, index] = id.split("#");
  if (!hash || hash.length <= 16) return id;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}${index !== undefined ? `#${index}` : ""}`;
}

export function renderBallotDeadlineEmail(
  input: BallotDeadlineTemplateInput,
): EmailTemplate {
  const hours = input.window === "48h" ? 48 : 24;
  const isTransaction = input.kind === "transaction";
  const label =
    input.label?.trim() ||
    (isTransaction ? "Untitled vote transaction" : "Untitled ballot");
  const subject = isTransaction
    ? `Vote closes in ${hours} hours: ${input.walletName}`
    : `Ballot closes in ${hours} hours: ${input.walletName}`;
  const deadlineText = `${formatUtc(input.deadline)} (end of epoch ${input.deadlineEpoch})`;
  const listed = input.proposals.slice(0, MAX_LISTED_PROPOSALS);
  const omitted = input.proposals.length - listed.length;
  const progress =
    isTransaction &&
    typeof input.signedCount === "number" &&
    typeof input.requiredCount === "number"
      ? `${input.signedCount} of ${input.requiredCount} required signatures collected`
      : null;

  const intro = isTransaction
    ? `The pending vote transaction <strong>${escapeHtml(label)}</strong> in <strong>${escapeHtml(input.walletName)}</strong> votes on proposals that stop accepting votes in about ${hours} hours.`
    : `The ballot <strong>${escapeHtml(label)}</strong> in <strong>${escapeHtml(input.walletName)}</strong> has proposals that stop accepting votes in about ${hours} hours.`;
  const introText = isTransaction
    ? `The pending vote transaction "${label}" in ${input.walletName} votes on proposals that stop accepting votes in about ${hours} hours.`
    : `The ballot "${label}" in ${input.walletName} has proposals that stop accepting votes in about ${hours} hours.`;
  const urgency = isTransaction
    ? `Votes must be on-chain before <strong>${escapeHtml(deadlineText)}</strong>. The transaction still needs the remaining signatures and must be submitted before then.`
    : `Votes must be on-chain before <strong>${escapeHtml(deadlineText)}</strong>. The vote transaction still needs to collect the wallet's signatures before then.`;
  const urgencyText = isTransaction
    ? `Votes must be on-chain before ${deadlineText}. The transaction still needs the remaining signatures and must be submitted before then.`
    : `Votes must be on-chain before ${deadlineText}. The vote transaction still needs to collect the wallet's signatures before then.`;

  const proposalRows = listed
    .map((proposal) => {
      const title = proposal.title?.trim() || shortProposalId(proposal.id);
      return `
      <tr>
        <td style="padding:10px 14px;border-top:1px solid #e5e7eb;">${escapeHtml(title)}</td>
        <td style="padding:10px 14px;border-top:1px solid #e5e7eb;text-align:right;color:#6b7280;white-space:nowrap;">epoch ${proposal.expirationEpoch}</td>
      </tr>`;
    })
    .join("");

  const bodyHtml = `
    <p style="margin:0 0 16px;">${intro}</p>
    <p style="margin:0 0 16px;">${urgency}</p>
    ${
      progress
        ? `<p style="margin:0 0 16px;font-weight:700;">${escapeHtml(progress)}</p>`
        : ""
    }
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border:1px solid #e5e7eb;border-radius:6px;">
      <tr>
        <td style="padding:12px 14px;color:#6b7280;">Proposal</td>
        <td style="padding:12px 14px;text-align:right;color:#6b7280;">Expires</td>
      </tr>
      ${proposalRows}
      ${
        omitted > 0
          ? `<tr><td colspan="2" style="padding:10px 14px;border-top:1px solid #e5e7eb;color:#6b7280;">and ${omitted} more</td></tr>`
          : ""
      }
    </table>
    ${
      isTransaction
        ? ""
        : `<p style="margin:0;color:#6b7280;font-size:13px;">If this ballot's votes have already been submitted, you can ignore this reminder.</p>`
    }
  `;

  const ctaLabel = isTransaction ? "Review and sign" : "Open governance";
  const html = renderEmailLayout({
    title: isTransaction
      ? `Vote closes in ${hours} hours`
      : `Ballot closes in ${hours} hours`,
    preview: `${input.walletName}: ${label} stops accepting votes ${deadlineText}.`,
    bodyHtml,
    ctaLabel,
    ctaUrl: input.actionUrl,
    footerHtml: `Manage wallet notification preferences here: <a href="${escapeHtml(input.preferencesUrl)}" style="color:#374151;">${escapeHtml(input.preferencesUrl)}</a>`,
  });

  const text = [
    subject,
    "",
    introText,
    urgencyText,
    progress ?? undefined,
    "",
    "Proposals:",
    ...listed.map(
      (proposal) =>
        `- ${proposal.title?.trim() || proposal.id} (expires epoch ${proposal.expirationEpoch})`,
    ),
    omitted > 0 ? `- and ${omitted} more` : undefined,
    "",
    isTransaction
      ? undefined
      : "If this ballot's votes have already been submitted, you can ignore this reminder.",
    `${ctaLabel}: ${input.actionUrl}`,
    `Manage notification preferences: ${input.preferencesUrl}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return { subject, html, text };
}
