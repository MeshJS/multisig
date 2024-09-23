import { PageHomepage } from "@/components/pages/homepage";
import PageWallets from "@/components/pages/wallets";
import useUser from "@/hooks/useUser";

export default function Page() {
  const { user } = useUser();
  return <>{user ? <PageWallets /> : <PageHomepage />}</>;
}
