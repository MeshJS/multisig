import type { InferGetStaticPropsType } from "next";

import { VaultGraphView } from "@/components/pages/homepage/roadmap/graph";
import { loadVaultGraph } from "@/lib/vault";

/**
 * The vault is a folder of files that only changes when the repo does, so it is
 * read once at build time rather than on every request. This is the one page in
 * the app using `getStaticProps` instead of a no-op `getServerSideProps`, and the
 * reason is that: no runtime filesystem access, and a malformed note fails the
 * build rather than a visitor's request.
 */
export const getStaticProps = () => ({ props: { graph: loadVaultGraph() } });

export default function Page({
  graph,
}: InferGetStaticPropsType<typeof getStaticProps>) {
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
