import { describe, expect, it, jest } from "@jest/globals";
import {
  PRE_SIGN_AUDIT_UNAVAILABLE,
  runPreSignProxyAudit,
} from "@/utils/preSignProxyAudit";

type AuditInput = { walletId: string; txCbor: string };

describe("runPreSignProxyAudit (browser gate before wallet.signTx)", () => {
  it("passes through a clean audit", async () => {
    const fetchAudit = jest.fn(async (_input: AuditInput) => ({ error: null as string | null }));
    await expect(
      runPreSignProxyAudit({ fetchAudit, walletId: "w", txCbor: "aa" }),
    ).resolves.toEqual({ ok: true });
    expect(fetchAudit).toHaveBeenCalledWith({ walletId: "w", txCbor: "aa" });
  });

  it("surfaces the server's refusal", async () => {
    const fetchAudit = jest.fn(async (_input: AuditInput) => ({ error: "nope" as string | null }));
    await expect(
      runPreSignProxyAudit({ fetchAudit, walletId: "w", txCbor: "aa" }),
    ).resolves.toEqual({ ok: false, message: "nope" });
  });

  it("fails closed when the audit cannot be reached", async () => {
    const fetchAudit = jest.fn(async (_input: AuditInput): Promise<{ error: string | null }> => {
      throw new Error("network");
    });
    await expect(
      runPreSignProxyAudit({ fetchAudit, walletId: "w", txCbor: "aa" }),
    ).resolves.toEqual({ ok: false, message: PRE_SIGN_AUDIT_UNAVAILABLE });
  });
});
