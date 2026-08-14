import type { InferGetServerSidePropsType } from "next";

import { VaultGraphView } from "@/components/pages/homepage/roadmap/graph";
import { loadVaultGraph } from "@/lib/vault";

/**
 * Read the vault per request, like every other page here.
 *
 * This originally used `getStaticProps` — the vault only changes when the repo
 * does, so parsing it once at build time was cheaper. That made Next *prerender*
 * the page, which fails: the app is a client-only SPA whose shell calls
 * `useRouter` outside a mounted router, so the export step dies with
 * "NextRouter was not mounted". It survived a local build and broke the Railway
 * one, which is exactly the kind of difference not worth fighting.
 *
 * The parse is memoised in {@link loadVaultGraph}, so per-request cost is one
 * read per process rather than one per visitor.
 */
export const getServerSideProps = () => ({ props: { graph: loadVaultGraph() } });

export default function Page({
  graph,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <div className="relative z-20 mx-auto w-full min-w-0 max-w-7xl py-10 lg:py-8">
      <div className="px-8">
        <h1 className="mx-auto max-w-5xl text-center text-3xl font-medium tracking-tight text-black dark:text-white lg:text-5xl lg:leading-tight">
          Feature graph
        </h1>
        <p className="mx-auto my-4 max-w-2xl text-center text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
          Every feature of Mesh Multisig and the state it is in, linked to the
          area it belongs to and the features it touches.
        </p>
      </div>

      <div className="mt-8 px-4 sm:px-8">
        <VaultGraphView graph={graph} />
      </div>
    </div>
  );
}
