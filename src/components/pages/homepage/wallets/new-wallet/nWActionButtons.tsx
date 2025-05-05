import { Button } from "@/components/ui/button";
import React from "react";

type NativeScriptType = "all" | "any" | "atLeast";

interface ButtonConfig {
  createNativeScript: () => void;
  handleSaveWallet: () => void;
  handleCreateNewWallet: () => void;
  loading: boolean;
  signersAddresses: string[];
  name: string;
  nativeScriptType: NativeScriptType;
  numRequiredSigners: number;
  pathIsWalletInvite: boolean;
}

interface WalletActionButtonsProps {
  buttonConfig: ButtonConfig;
}

const WalletActionButtons: React.FC<WalletActionButtonsProps> = ({ buttonConfig }) => {
  const {
    createNativeScript,
    handleSaveWallet,
    handleCreateNewWallet,
    loading,
    signersAddresses,
    name,
    nativeScriptType,
    numRequiredSigners,
    pathIsWalletInvite,
  } = buttonConfig;

  return (
    <div className="flex gap-4">
      <Button
        onClick={createNativeScript}
        disabled={
          signersAddresses.length === 0 ||
          signersAddresses.some((signer) => !signer || signer.length === 0) ||
          (nativeScriptType === "atLeast" && numRequiredSigners === 0) ||
          name.length === 0 ||
          loading
        }
      >
        {loading ? "Creating Wallet..." : "Create Wallet"}
      </Button>
      {pathIsWalletInvite ? (
        <Button onClick={handleSaveWallet} disabled={loading}>
          {loading ? "Saving Wallet..." : "Save Wallet for Later"}
        </Button>
      ) : (
        <Button onClick={handleCreateNewWallet} disabled={loading}>
          Save Wallet and Invite Signers
        </Button>
      )}
    </div>
  );
};

export default WalletActionButtons;