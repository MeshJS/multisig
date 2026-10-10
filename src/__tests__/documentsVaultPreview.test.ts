import { afterEach, describe, expect, it, jest } from "@jest/globals";

import type { VaultTrustView } from "@/lib/vault-trust-types";

type Props = { props: { view: VaultTrustView | null } };

const MODULE = "@/lib/documents/vault-preview";

/**
 * The preview embeds the demo vault inside a wallet page, which puts a
 * filesystem read and a hash graph on the request path of a treasury surface.
 * Two things must hold: the props Next hands the client are actually
 * serialisable, and a vault that fails to build hides the panel instead of
 * taking the page down.
 */
describe("documents vault preview page", () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("supplies a view that survives Next's JSON serialisation", async () => {
    const { loadVaultPreviewProps } = await import(MODULE);
    const result = { props: loadVaultPreviewProps() } as Props;

    expect(result.props.view).not.toBeNull();
    expect(result.props.view!.hubs.length).toBeGreaterThan(0);
    expect(result.props.view!.notes.length).toBeGreaterThan(0);
    expect(result.props.view!.rootHash).toMatch(/^[0-9a-f]{64}$/);

    // getServerSideProps props are JSON-serialised. A Map, Set, Date or
    // undefined in there is a runtime "Error serializing" on the deployed page
    // that no type check catches, so assert the round trip is lossless.
    const roundTripped: unknown = JSON.parse(JSON.stringify(result.props.view));
    expect(roundTripped).toEqual(result.props.view);
  });

  it("hides the panel instead of 500-ing when the vault will not build", async () => {
    jest.resetModules();
    jest.doMock("@/lib/vault-trust", () => ({
      loadVaultTrustView: () => {
        throw new Error("vault trust graph: Trust cycle: A -> B -> A");
      },
    }));
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { loadVaultPreviewProps } = await import(MODULE);
    const result = { props: loadVaultPreviewProps() } as Props;

    // Degraded, not thrown: a Markdown edit in an unrelated directory must not
    // be able to take down a wallet's Documents section.
    expect(result.props.view).toBeNull();
    expect(errors).toHaveBeenCalled();
  });
});
