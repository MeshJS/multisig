import PageHeader from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import WalletComponent from "./cip146/146Wallet";
import { getPubKeyHash, KeyObject, pubKeyToAddr } from "./cip146/146sdk";
import useUser from "@/hooks/useUser";

export default function PageNewWalletInvite() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [signersDescription, setSignerDescription] = useState<string>("");
  const [signersName, setSignerName] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<KeyObject[]>([]);
  const [parentAddress, setParentAddress] = useState<string>("");
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();

  const pathIsNewWallet = router.pathname === "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  const { mutate: updateNewWalletSigners } =
    api.wallet.updateNewWalletSigners.useMutation({
      onSuccess: async () => {
        setLoading(false);
        toast({
          title: "Your Info Updated",
          description: "Your info has been updated",
          duration: 5000,
        });
        router.push("/wallets");
      },
      onError: (e) => {
        setLoading(false);
        console.error(e);
      },
    });

  async function addSigner() {
    if (!newWallet) throw new Error("Wallet invite is undefined");
    // Use the user's address if available, otherwise the computed parent address
    const addressToStore = user ? userAddress : parentAddress;
    if (!addressToStore) throw new Error("Address is undefined");
 
    setLoading(true);
    updateNewWalletSigners({
      walletId: newWalletId!,
      signersAddresses: [...newWallet.signersAddresses, addressToStore],
      signersDescriptions: [
        ...newWallet.signersDescriptions,
        signersDescription,
      ],
    });
  }

  useEffect(() => {
    let combined = `name:${signersName};\n`;
    selectedKeys.forEach((key) => {
      const pubKeyHash = key.publicKey ? getPubKeyHash(key.publicKey) : "N/A";
      const keyIndex =
        key.derivationPath.index !== undefined ? key.derivationPath.index : "";
      combined += `key${keyIndex}:${pubKeyHash};\n`;
    });
    setSignerDescription(combined);
  }, [signersName, selectedKeys]);

  useEffect(() => {
    if (!user && selectedKeys.length > 0) {
      // Assume the first key is the parent key
      const parentAddr = pubKeyToAddr(selectedKeys[1]!,selectedKeys[2]!, false); // false for Testnet, adjust as needed
      setParentAddress(parentAddr);
    }
  }, [user, selectedKeys]);

  return (
    <div className="container mx-auto px-4 py-4">
      <PageHeader
        pageTitle={`Invited as Signer${newWallet ? ` for: ${newWallet.name}` : ""}`}
      />
      {newWallet && (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
          {/* Left side: Invitation details */}
          <Card className="w-full md:w-1/2">
            <CardHeader>
              <CardTitle>You are invited as Signer</CardTitle>
              <CardDescription>
                You are invited to be a signer of this multi-signature wallet.
                Please confirm your address and add your name.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="address">Your address</Label>
                  <Input
                    id="address"
                    type="text"
                    value={user ? userAddress : parentAddress}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Your Name</Label>
                  <Input
                    id="description"
                    type="text"
                    placeholder="e.g., Alice, Bob, etc."
                    value={signersName}
                    onChange={(e) => setSignerName(e.target.value)}
                  />
                </div>
              </div>
              <p>{signersDescription}</p>
              <div className="space-y-2">
                <Button
                  onClick={addSigner}
                  disabled={loading || !signersDescription}
                  className="w-full md:w-auto"
                >
                  {loading ? "Adding..." : "Add me as signer"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <WalletComponent
            onSelectChildKeys={(childKeys) => {
              console.log("Index received selected child keys:", childKeys);
              setSelectedKeys(childKeys);
            }}
          />
        </div>
      )}
    </div>
  );
}
