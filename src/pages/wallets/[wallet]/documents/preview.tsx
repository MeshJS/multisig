import type { InferGetServerSidePropsType } from "next";

import PageDocumentsVaultPreview from "@/components/pages/wallet/documents/vault-preview";
import { loadVaultPreviewProps } from "@/lib/documents/vault-preview";

/**
 * Shielded sign-off, previewed inside the wallet's Documents section.
 *
 * `getServerSideProps` rather than static, for the reason /vault and
 * /roadmap/graph both use it: prerendering this SPA dies with "NextRouter was
 * not mounted", which passes locally and breaks the deployed build.
 */
export const getServerSideProps = () => ({ props: loadVaultPreviewProps() });

export default function PageWalletDocumentsPreview({
  view,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <PageDocumentsVaultPreview view={view} />;
}
