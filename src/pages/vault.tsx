import type { InferGetServerSidePropsType } from "next";

import VaultBrowser from "@/components/pages/vault/browser";
import { loadVaultTrustView } from "@/lib/vault-trust";

/**
 * The vault, browsable, with its trust graph over the top.
 *
 * `getServerSideProps` rather than static for the same reason /roadmap/graph
 * uses it: prerendering this SPA dies with "NextRouter was not mounted", and it
 * survives a local build while breaking the deployed one.
 */
export const getServerSideProps = () => ({
  props: { view: loadVaultTrustView() },
});

export default function Page({
  view,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <div className="relative z-20 mx-auto w-full min-w-0 max-w-[1400px] py-10 lg:py-8">
      <div className="px-8">
        <h1 className="text-3xl font-medium tracking-tight text-black dark:text-white lg:text-4xl">
          Vault
        </h1>
        <p className="my-4 max-w-3xl text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
          Linked Markdown, hashed so every trust edge commits to what it points
          at. Areas act as proxy hubs; the root commits to their hashes and
          never their titles. Selecting a note shows the path a proof of it
          would reveal, and the siblings it would keep sealed.
        </p>
        <p className="my-4 max-w-3xl text-sm text-neutral-500 dark:text-neutral-300 lg:text-base">
          New to this?{" "}
          <a
            href="/blog/how-to-use-shielded-sign-off"
            className="underline underline-offset-2"
          >
            How to use shielded sign-off
          </a>{" "}
          explains the two kinds of link, why one hub is not enough, and exactly
          what a disclosure gives away.
        </p>
        <p className="max-w-3xl font-mono text-xs text-neutral-500 dark:text-neutral-400">
          root {view.rootHash.slice(0, 32)}… · {view.hubs.length} hubs ·{" "}
          {view.notes.length} notes
        </p>
      </div>

      <div className="mt-8 px-4 sm:px-8">
        <VaultBrowser view={view} />
      </div>
    </div>
  );
}
