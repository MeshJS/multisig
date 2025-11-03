import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";

import type { MultisigKey } from "@/utils/multisigSDK";
import { MultisigWallet } from "@/utils/multisigSDK";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";

import PageHeader from "@/components/common/page-header";
import WalletInfoCard from "@/components/pages/homepage/wallets/new-wallet/nWInfoCard";
import SignersCard from "@/components/pages/homepage/wallets/new-wallet/nWSignersCard";
import AdvancedOptionsCard from "@/components/pages/homepage/wallets/new-wallet/nWAdvancedOptionsCard";
import WalletActionButtons from "@/components/pages/homepage/wallets/new-wallet/nWActionButtons";
import InspectMultisigScript from "@/components/multisig/inspect-multisig-script";


export default function PageNewWallet() {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [signersStakeKeys, setSignerStakeKeys] = useState<string[]>([]);
  const [signersDRepKeys, setSignerDRepKeys] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(1);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const network = useSiteStore((state) => state.network);
  const { toast } = useToast();
  const [nativeScriptType, setNativeScriptType] = useState<
    "all" | "any" | "atLeast"
  >("atLeast");
  const [stakeKey, setStakeKey] = useState<string>("");
  const pathIsWalletInvite = router.pathname == "/wallets/new-wallet/[id]";
  const walletInviteId = pathIsWalletInvite
    ? (router.query.id as string)
    : undefined;

  const multisigWallet = useMemo(() => {
    const keys: MultisigKey[] = [];
    if (signersAddresses.length === 0) return;

    if (signersAddresses.length > 0) {
      signersAddresses.forEach((addr, i) => {
        if (addr) {
          try {
            const paymentHash = resolvePaymentKeyHash(addr);
            keys.push({
              keyHash: paymentHash,
              role: 0,
              name: signersDescriptions[i] ?? "",
            });
          } catch (e) {
            console.warn(`Invalid payment address at index ${i}:`, addr);
          }
        }
      });
    }

    if (signersStakeKeys.length > 0) {
      signersStakeKeys.forEach((stakeKey, i) => {
        if (stakeKey) {
          try {
            const stakeKeyHash = resolveStakeKeyHash(stakeKey);
            keys.push({
              keyHash: stakeKeyHash,
              role: 2,
              name: signersDescriptions[i] ?? "",
            });
          } catch (e) {
            console.warn(`Invalid stake address at index ${i}:`, stakeKey);
          }
        }
      });
    }
    if (keys.length === 0) return;
    return new MultisigWallet(name, keys, description, numRequiredSigners, network);
  }, [
    name,
    description,
    signersAddresses,
    signersStakeKeys,
    signersDescriptions,
    numRequiredSigners,
    network,
  ]);

  const { mutate: deleteWalletInvite } = api.wallet.deleteNewWallet.useMutation(
    {
      onError: () => {
        console.error();
      },
    },
  );

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: async () => {
      if (pathIsWalletInvite) {
        deleteWalletInvite({ walletId: walletInviteId! });
      }
      setLoading(false);
      await router.push("/wallets");
      toast({
        title: "Wallet Created",
        description: "Your wallet has been created",
        duration: 5000,
      });
    },
    onError: () => {
      setLoading(false);
      console.error();
    },
  });

  const { mutate: createNewWallet } = api.wallet.createNewWallet.useMutation({
    onSuccess: async (data) => {
      setLoading(false);
      await router.push(`/wallets/new-wallet/${data.id}`);
      await navigator.clipboard.writeText(
        `https://multisig.meshjs.dev/wallets/invite/${data.id}`,
      );
      toast({
        title: "Wallet Saved and invite link copied",
        description:
          "Your wallet has been saved and invite link copied in clipboard",
        duration: 5000,
      });
    },
    onError: () => {
      setLoading(false);
      console.error();
    },
  });

  const { mutate: updateNewWallet } = api.wallet.updateNewWallet.useMutation({
    onSuccess: async () => {
      setLoading(false);
      toast({
        title: "Wallet Info Updated",
        description: "Your wallet has been saved",
        duration: 5000,
      });
      await router.push("/wallets");
    },
    onError: () => {
      setLoading(false);
      console.error();
    },
  });

  const { data: walletInvite } = api.wallet.getNewWallet.useQuery(
    { walletId: walletInviteId! },
    {
      enabled: pathIsWalletInvite && walletInviteId !== undefined,
    },
  );

  // Initialize first signer with current user
  useEffect(() => {
    if (!user) return;
    setSignerAddresses([user.address]);
    setSignerDescriptions([""]);
    setSignerStakeKeys([user.stakeAddress]);
  }, [user]);

  useEffect(() => {
    if (pathIsWalletInvite && walletInvite) {
      setName(walletInvite.name);
      setDescription(walletInvite.description ?? "");
      setSignerAddresses(walletInvite.signersAddresses);
      setSignerDescriptions(walletInvite.signersDescriptions);
      setSignerStakeKeys(walletInvite.signersStakeKeys);
      setNumRequiredSigners(walletInvite.numRequiredSigners!);
    }
  }, [pathIsWalletInvite, walletInvite]);

  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
    // Only add empty stake key if no external stake credential is set
    setSignerStakeKeys([...signersStakeKeys, stakeKey ? "" : ""]);
  }

  async function createNativeScript() {
    setLoading(true);

    if (!multisigWallet) {
      setLoading(false);
      throw new Error("Multisig wallet could not be built.");
    }

    const { scriptCbor } = multisigWallet.getScript();
    if (!scriptCbor) {
      setLoading(false);
      throw new Error("scriptCbor is undefined");
    }

    createWallet({
      name: name,
      description: description,
      signersAddresses: signersAddresses,
      signersDescriptions: signersDescriptions,
      signersStakeKeys: signersStakeKeys,
      signersDRepKeys: signersDRepKeys,
      numRequiredSigners: numRequiredSigners,
      scriptCbor: scriptCbor,
      stakeCredentialHash: stakeKey.length > 0 ? stakeKey : undefined,
      type: nativeScriptType,
    });
  }

  async function handleCreateNewWallet() {
    if (router.pathname == "/wallets/new-wallet") {
      setLoading(true);
      createNewWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        ownerAddress: userAddress!,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }

  async function handleSaveWallet() {
    if (pathIsWalletInvite) {
      setLoading(true);
      updateNewWallet({
        walletId: walletInviteId!,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }

  return (
    <>
      <PageHeader
        pageTitle={`New Wallet${pathIsWalletInvite && walletInvite ? `: ${walletInvite.name}` : ""}`}
      ></PageHeader>
      {user && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-1 md:grid-cols-2">
          {/* Wallet Info */}
          <div className="col-span-2 md:col-span-1">
            <WalletInfoCard
              walletInfo={{
                name,
                setName,
                description,
                setDescription,
              }}
            />
          </div>

          {/* Advanced Options */}
          <div className="col-span-2 md:col-span-1">
            <AdvancedOptionsCard
              advancedConfig={{
                stakeKey,
                setStakeKey,
                nativeScriptType,
                setNativeScriptType,
              }}
            />
          </div>

          {/* Signers */}
          <div className="col-span-2">
            <SignersCard
              signerConfig={{
                signersAddresses,
                setSignerAddresses,
                signersDescriptions,
                setSignerDescriptions,
                signersStakeKeys,
                setSignerStakeKeys,
                numRequiredSigners,
                setNumRequiredSigners,
                addSigner,
                pathIsWalletInvite,
                walletInviteId,
                nativeScriptType,
                toast,
                handleCreateNewWallet: () => void handleCreateNewWallet(),
                loading,
              }}
            />
          </div>

          {/* Script Inspector */}
          <div className="col-span-2">
            <InspectMultisigScript mWallet={multisigWallet} />
          </div>

          {/* Action Buttons */}
          <div className="col-span-2 flex justify-end gap-4 sm:justify-center">
            <WalletActionButtons
              buttonConfig={{
                createNativeScript: () => void createNativeScript(),
                handleSaveWallet: () => void handleSaveWallet(),
                handleCreateNewWallet: () => void handleCreateNewWallet(),
                loading,
                signersAddresses,
                name,
                nativeScriptType,
                numRequiredSigners,
                pathIsWalletInvite,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
