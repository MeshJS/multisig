import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import BuilderCanvas from "@/components/pages/wallet/build/builder-canvas";
import type { AddressLabeler } from "@/types/token-flow";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";

declare global {
  interface Window {
    addRecipient: () => void;
    recompute: (times: number) => Promise<void>;
  }
}

const WALLET =
  "addr_test1qpq0u3k4mwqsrd2qu4w6mqvmu6m0jc6jtxxhjpkqx9mhr5cz2ytlqyfh8a8h6m0gwa2y7mzaedmhfvhkm8m5ksu3qq6sszc4sy";
const SIGNER =
  "addr_test1vpkdpqwzkr5eqxlwjmjzpaqfl8cxk4kwl4nh2xvjdz0aj8gslwecd";

function Canvas() {
  const [generation, setGeneration] = useState(0);
  // One macrotask per re-render, like wallet, label and UTxO queries landing
  // one after another while the builder opens a deep-linked transaction.
  useEffect(() => {
    window.recompute = async (times) => {
      for (let i = 0; i < times; i += 1) {
        setGeneration((value) => value + 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
  }, []);
  // A new labeler identity per render recomputes every card's layout node.
  const labelAddress: AddressLabeler = (address) =>
    address === SIGNER
      ? { label: "Signer 1", type: "signer" }
      : { label: `Multisig ${generation}`, type: "self" };
  return (
    <div style={{ width: 900, height: 600 }}>
      <BuilderCanvas
        walletAddress={WALLET}
        labelAddress={labelAddress}
        contacts={[]}
        signers={[]}
        onAddStakeAction={() => {}}
        onAddVote={() => {}}
      />
    </div>
  );
}

window.addRecipient = () => {
  const store = useTxBuilderStore.getState();
  const outputId = store.addOutput({ address: SIGNER });
  store.setOutputAsset(outputId, "lovelace", "8000000");
};
useTxBuilderStore.getState().resetDraft("wallet");
window.addRecipient();
createRoot(document.getElementById("root")!).render(<Canvas />);
