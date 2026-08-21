import HydraBudgetVote from "@/components/pages/wallet/governance/hydra/HydraBudgetVote";

export const getServerSideProps = () => ({ props: {} });

export default function PageWalletHydraVote() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-3 sm:p-4 lg:p-8">
      <HydraBudgetVote />
    </main>
  );
}
