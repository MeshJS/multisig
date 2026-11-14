import { describe, expect, it } from "@jest/globals";
import {
  governanceDRepView,
  isProxyModeBlocked,
  proxyModeBlockedMessage,
  resolveProxyMode,
} from "@/lib/proxy/proxyMode";

const proxyA = { id: "proxy-a", proxyAddress: "addr_test1proxyA" };
const proxyB = { id: "proxy-b", proxyAddress: "addr_test1proxyB" };

describe("resolveProxyMode", () => {
  it("acts directly when no proxy is selected, whatever the wallet's proxies", () => {
    expect(resolveProxyMode({ selectedProxyId: "", proxies: [proxyA] })).toEqual({ kind: "direct" });
    expect(resolveProxyMode({ selectedProxyId: undefined, proxies: undefined })).toEqual({ kind: "direct" });
    expect(resolveProxyMode({ selectedProxyId: null, proxies: [] })).toEqual({ kind: "direct" });
  });

  it("uses the selected proxy when it is one of this wallet's proxies", () => {
    const mode = resolveProxyMode({ selectedProxyId: "proxy-b", proxies: [proxyA, proxyB] });
    expect(mode).toEqual({ kind: "proxy", proxy: proxyB });
  });

  it("waits, rather than voting directly, while the wallet's proxies are still loading", () => {
    // The old check read an unloaded list as "no proxy" and cast a direct
    // DRep vote if the user clicked before the query resolved.
    expect(resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined })).toEqual({ kind: "loading" });
    expect(resolveProxyMode({ selectedProxyId: "proxy-a", proxies: null })).toEqual({ kind: "loading" });
  });

  it("reports a failed proxy query as an error, not as loading forever", () => {
    expect(
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined, loadFailed: true }),
    ).toEqual({ kind: "error" });
    // A list already in hand wins over a later failed refetch.
    expect(
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyA], loadFailed: true }),
    ).toEqual({ kind: "proxy", proxy: proxyA });
  });

  it("refuses a selection carried over from another wallet or a deactivated proxy", () => {
    // The selection is persisted globally, so it survives switching wallets.
    expect(resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyB] })).toEqual({ kind: "unavailable" });
    expect(resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [] })).toEqual({ kind: "unavailable" });
  });
});

describe("isProxyModeBlocked / proxyModeBlockedMessage", () => {
  it("lets direct and proxy actions through with no message", () => {
    for (const mode of [
      resolveProxyMode({ selectedProxyId: "", proxies: [] }),
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyA] }),
    ]) {
      expect(isProxyModeBlocked(mode)).toBe(false);
      expect(proxyModeBlockedMessage(mode)).toBeNull();
    }
  });

  it("blocks loading, error and unavailable modes with a message that says why", () => {
    const loading = resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined });
    const failed = resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined, loadFailed: true });
    const unavailable = resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyB] });

    expect(isProxyModeBlocked(loading)).toBe(true);
    expect(isProxyModeBlocked(failed)).toBe(true);
    expect(isProxyModeBlocked(unavailable)).toBe(true);
    expect(proxyModeBlockedMessage(loading)?.title).toMatch(/loading/i);
    expect(proxyModeBlockedMessage(failed)?.title).toMatch(/couldn't load/i);
    // Both unrecoverable modes must name the way out offered next to them.
    expect(proxyModeBlockedMessage(failed)?.description).toMatch(/clear the proxy selection/i);
    expect(proxyModeBlockedMessage(unavailable)?.description).toMatch(/pick one of this wallet's proxies/i);
    expect(proxyModeBlockedMessage(unavailable)?.description).toMatch(/clear the proxy selection/i);
  });
});

describe("governanceDRepView", () => {
  const walletDrepId = "drep1wallet";
  const proxyDrepA = { proxyId: "proxy-a", drepId: "drep1proxyA" };

  it("shows the wallet's own DRep when no proxy is selected", () => {
    const mode = resolveProxyMode({ selectedProxyId: "", proxies: [proxyA] });
    expect(governanceDRepView(mode, { walletDrepId, proxyDrep: proxyDrepA })).toEqual({
      dRepId: walletDrepId,
      isProxy: false,
    });
    expect(governanceDRepView(mode, { walletDrepId: undefined, proxyDrep: null })).toEqual({
      dRepId: null,
      isProxy: false,
    });
  });

  it("shows the selected proxy's DRep once it has been derived for that proxy", () => {
    const mode = resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyA, proxyB] });
    expect(governanceDRepView(mode, { walletDrepId, proxyDrep: proxyDrepA })).toEqual({
      dRepId: "drep1proxyA",
      isProxy: true,
    });
  });

  it("shows nothing, not the wallet's DRep, while the proxy DRep id is still being derived", () => {
    // The old `proxyDrepId || walletDrepId` showed the wallet's votes under
    // "Proxy DRep Voting Statistics" and as each proposal's "Your Vote".
    const mode = resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyA] });
    expect(governanceDRepView(mode, { walletDrepId, proxyDrep: null })).toEqual({
      dRepId: null,
      isProxy: true,
    });
  });

  it("ignores a DRep id derived for the previously selected proxy", () => {
    const mode = resolveProxyMode({ selectedProxyId: "proxy-b", proxies: [proxyA, proxyB] });
    expect(governanceDRepView(mode, { walletDrepId, proxyDrep: proxyDrepA })).toEqual({
      dRepId: null,
      isProxy: true,
    });
  });

  it("shows nothing while Proxy Mode is blocked (loading, error, unavailable)", () => {
    for (const mode of [
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined }),
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: undefined, loadFailed: true }),
      resolveProxyMode({ selectedProxyId: "proxy-a", proxies: [proxyB] }),
    ]) {
      expect(governanceDRepView(mode, { walletDrepId, proxyDrep: proxyDrepA })).toEqual({
        dRepId: null,
        isProxy: true,
      });
    }
  });
});
