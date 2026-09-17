import { loadVaultTrustView } from "@/lib/vault-trust";
import type { VaultTrustView } from "@/lib/vault-trust-types";

/**
 * Props for the shielded sign-off preview inside a wallet's Documents section.
 *
 * Server-only: `loadVaultTrustView` reads the filesystem, so this must never be
 * imported from a client component.
 *
 * It lives here rather than inline in the page for the same reason every other
 * page under `documents/` is a thin shell — and because the behaviour below is
 * worth testing on its own, which importing the page cannot do: the page pulls
 * the whole component tree, including ESM-only `react-markdown`.
 */
export function loadVaultPreviewProps(): { view: VaultTrustView | null } {
  try {
    return { view: loadVaultTrustView() };
  } catch (error) {
    // `loadVaultTrustView` throws when the vault's trust edges are not a DAG.
    // That is right for a build-time check and wrong here: this panel is
    // illustrative content on a treasury page, and an unrelated Markdown edit
    // must not be able to turn Documents into a 500. A CI test asserts the
    // vault IS a DAG, so this branch should stay unreachable — and if it ever
    // is reached, hiding one panel beats taking the page down.
    console.error("vault preview unavailable", {
      message: (error as Error)?.message,
    });
    return { view: null };
  }
}
