import { describe, expect, it, jest } from "@jest/globals";

import {
  NOTIFICATION_STATUS_SKIPPED_DISABLED,
  NOTIFICATION_STATUS_SKIPPED_NO_EMAIL,
  NOTIFICATION_STATUS_SKIPPED_NOT_VERIFIED,
  NOTIFICATION_STATUS_SKIPPED_OPTED_OUT,
} from "@/lib/notifications/events";
import { resolveSignatureRecipients } from "@/lib/notifications/recipients";
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
    });

    expect(email.subject).toBe("Signature required: <Vault>");
    expect(email.html).toContain("&lt;Vault&gt;");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(email.html).not.toContain("<script>alert");
    expect(email.text).toContain("A transaction in <Vault> is waiting");
    expect(email.text).toContain("Review and sign:");
  });
});
