import { describe, expect, it, jest } from "@jest/globals";

import {
  NOTIFICATION_STATUS_SKIPPED_DISABLED,
  NOTIFICATION_STATUS_SKIPPED_NO_EMAIL,
  NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED,
  NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
} from "@/lib/notifications/events";
import { resolveSignatureRecipients } from "@/lib/notifications/recipients";
import {
  maskAddress,
  summarizeSignableSignatureContext,
  summarizeTransactionSignatureContext,
} from "@/lib/notifications/signatureContext";
import { renderSignatureRequiredEmail } from "@/lib/notifications/templates/signatureRequired";

describe("notification recipient resolution", () => {
  it("returns only verified opted-in signers that still need to sign", async () => {
    const db = {
      walletSignerNotificationSetting: {
        findMany: jest.fn(async () => [
          {
            signerAddress: "addr_verified",
            email: "Signer@Example.com",
            emailNormalized: "signer@example.com",
            emailVerifiedAt: new Date(),
            emailOptIn: true,
            notifyTransactionSignatures: true,
            notifySignableSignatures: true,
          },
          {
            signerAddress: "addr_unverified",
            email: "unverified@example.com",
            emailNormalized: "unverified@example.com",
            emailVerifiedAt: null,
            emailOptIn: true,
            notifyTransactionSignatures: true,
            notifySignableSignatures: true,
          },
          {
            signerAddress: "addr_opted_out",
            email: "out@example.com",
            emailNormalized: "out@example.com",
            emailVerifiedAt: new Date(),
            emailOptIn: false,
            notifyTransactionSignatures: true,
            notifySignableSignatures: true,
          },
          {
            signerAddress: "addr_disabled",
            email: "disabled@example.com",
            emailNormalized: "disabled@example.com",
            emailVerifiedAt: new Date(),
            emailOptIn: true,
            notifyTransactionSignatures: false,
            notifySignableSignatures: true,
          },
        ]),
      },
    };

    const result = await resolveSignatureRecipients(db as any, {
      walletId: "wallet_1",
      signerAddresses: [
        "addr_creator",
        "addr_signed",
        "addr_rejected",
        "addr_verified",
        "addr_unverified",
        "addr_opted_out",
        "addr_disabled",
        "addr_missing",
      ],
      resourceType: "transaction",
      signedAddresses: ["addr_signed"],
      rejectedAddresses: ["addr_rejected"],
      creatorAddress: "addr_creator",
    });

    expect(result.eligible).toEqual([
      {
        address: "addr_verified",
        email: "Signer@Example.com",
        emailNormalized: "signer@example.com",
      },
    ]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        {
          address: "addr_unverified",
          reason: NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED,
        },
        {
          address: "addr_opted_out",
          reason: NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
        },
        {
          address: "addr_disabled",
          reason: NOTIFICATION_STATUS_SKIPPED_DISABLED,
        },
        {
          address: "addr_missing",
          reason: NOTIFICATION_STATUS_SKIPPED_NO_EMAIL,
        },
      ]),
    );
  });
});

describe("notification email templates", () => {
  it("escapes dynamic values and returns html plus text bodies", () => {
    const email = renderSignatureRequiredEmail({
      walletName: "<Vault>",
      resourceType: "transaction",
      description: "<script>alert('x')</script>",
      signedCount: 1,
      requiredCount: 2,
      totalSigners: 3,
      actionUrl: "https://example.com/sign?x=<bad>",
      preferencesUrl: "https://example.com/preferences",
      signatureContext: {
        summary: "Send 50 ADA to addr_tes...3te2",
        details: [{ label: "Outputs", value: "2 total outputs" }],
      },
    });

    expect(email.subject).toBe("Signature required: <Vault>");
    expect(email.html).toContain("&lt;Vault&gt;");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).not.toContain("<script>alert");
    expect(email.text).toContain("A transaction in <Vault> is waiting");
    expect(email.text).toContain("What needs signing: Send 50 ADA");
    expect(email.html).toContain("What needs signing");
    expect(email.html.indexOf("Description")).toBeLessThan(
      email.html.indexOf("What needs signing"),
    );
    expect(email.text.indexOf("Description:")).toBeLessThan(
      email.text.indexOf("What needs signing:"),
    );
    expect(email.text).toContain("Review and sign:");
  });

  it("truncates long descriptions in html and text bodies", () => {
    const longDescription = "Governance ".repeat(40).trim();
    const email = renderSignatureRequiredEmail({
      walletName: "Vault",
      resourceType: "transaction",
      description: longDescription,
      signedCount: 0,
      requiredCount: 2,
      totalSigners: 3,
      actionUrl: "https://example.com/sign",
      preferencesUrl: "https://example.com/preferences",
    });

    expect(email.html).toContain("Description");
    expect(email.html).toContain("...");
    expect(email.html).not.toContain(longDescription);
    expect(email.text).toContain("Description:");
    expect(email.text).toContain("...");
    expect(email.text).not.toContain(longDescription);
  });
});

describe("notification signature context summaries", () => {
  it("summarizes transfer outputs without revealing full recipient addresses", () => {
    const fullAddress = "addr_test1qpy7y6u20jv7ky7p4vte2";
    const summary = summarizeTransactionSignatureContext({
      outputs: [
        {
          address: fullAddress,
          amount: [{ unit: "lovelace", quantity: "50000000" }],
        },
      ],
    });

    expect(summary?.summary).toBe(`Send 50 ADA to ${maskAddress(fullAddress)}`);
    expect(summary?.summary).not.toContain(fullAddress);
  });

  it("summarizes governance proxy vote metadata", () => {
    const summary = summarizeTransactionSignatureContext({
      proxyBot: {
        kind: "proxyVote",
        votes: [
          {
            proposalId:
              "0123456789abcdef0123456789abcdef0123456789abcdef01234567#0",
            voteKind: "Yes",
          },
        ],
      },
    });

    expect(summary?.summary).toContain("Governance Yes vote");
    expect(summary?.summary).toContain("01234567");
    expect(summary?.summary).toContain("...67#0");
  });

  it("summarizes signable governance payloads by method", () => {
    expect(
      summarizeSignableSignatureContext({
        method: "ekklesia-vote",
        description: "Hydra Budget Vote",
      }),
    ).toEqual({ summary: "Governance vote package" });
  });

  it("falls back to governance descriptions when transaction metadata is generic", () => {
    expect(summarizeTransactionSignatureContext("{}", "Vote: Yes - Treasury")).toEqual({
      summary: "Governance action: Vote: Yes - Treasury",
    });
  });
});
