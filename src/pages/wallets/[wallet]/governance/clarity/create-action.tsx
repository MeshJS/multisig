import CreateClarityActionPage from "@/components/pages/wallet/governance/clarity/create-clarity-action-page";

export const getServerSideProps = () => ({ props: {} });

export default function CreateActionRoute() {
  return <CreateClarityActionPage />;
}
