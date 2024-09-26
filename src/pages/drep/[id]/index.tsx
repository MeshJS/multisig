import DrepLandingPage from "@/components/pages/drep/landing-page";
import { useRouter } from "next/router";

export default function PageDrepId() {
  const router = useRouter();
  const drepid = router.query.id as string;
  return <DrepLandingPage drepid={drepid} />;
}
