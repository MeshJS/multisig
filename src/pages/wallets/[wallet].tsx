import PageWallet from "@/components/pages/wallet";
import { useRouter } from "next/router";

export default function Page() {
  const router = useRouter();
  return <PageWallet walletId={router.query.wallet as string} />;
}
