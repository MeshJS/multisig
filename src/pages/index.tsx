import { PageHomepage } from "@/components/pages/homepage";
import dynamic from "next/dynamic";

// The signed-in dashboard needs the wallet stack; a signed-out visitor never
// sees it, so it is not part of the homepage bundle.
const PageWallets = dynamic(() => import("@/components/pages/homepage/wallets"));
import useUser from "@/hooks/useUser";

export const getServerSideProps = () => ({ props: {} });

export default function Page() {
  const { user } = useUser();
  return <>{user ? <PageWallets /> : <PageHomepage />}</>;
}
