import WalletGovernanceProposal from "@/components/pages/wallet/governance/proposal";
import { useRouter } from "next/router";

export default function PageWalletGovernanceProposal() {
  const router = useRouter();
  const drepid = router.query.id as string;
  return <WalletGovernanceProposal id={drepid} />;
}
