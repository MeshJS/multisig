export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailLayout(args: {
  title: string;
  preview: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerHtml?: string;
}): string {
  const cta = args.ctaLabel && args.ctaUrl
    ? `
      <tr>
        <td style="padding:24px 0 8px;">
          <a href="${escapeHtml(args.ctaUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;padding:12px 18px;font-weight:700;">
            ${escapeHtml(args.ctaLabel)}
          </a>
        </td>
      </tr>
    `
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(args.preview)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;margin:0;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 10px;">
                <p style="margin:0 0 8px;color:#6b7280;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;">Mesh Multisig</p>
                <h1 style="margin:0;color:#111827;font-size:24px;line-height:1.25;">${escapeHtml(args.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px;font-size:15px;line-height:1.6;color:#374151;">
                ${args.bodyHtml}
                <table role="presentation" cellspacing="0" cellpadding="0">
                  ${cta}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
                ${args.footerHtml ?? "You received this email because notifications are enabled for this multisig wallet."}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
