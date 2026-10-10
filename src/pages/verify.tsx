import PageVerifyProof from "@/components/pages/verify";

/**
 * Public proof verifier. `getServerSideProps` for the same reason the other
 * client-only pages use it: prerendering a page that mounts the wallet
 * providers dies with "NextRouter was not mounted" on the deployed build.
 */
export const getServerSideProps = () => ({ props: {} });

export default function Page() {
  return <PageVerifyProof />;
}
