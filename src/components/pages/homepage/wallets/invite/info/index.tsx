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
import { useState } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";

export default function PageNewWalletInviteInfo() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [signersDescription, setSignerDescription] = useState<string>("");
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();

  const pathIsNewWallet = router.pathname == "/wallets/invite/info/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  const { mutate: updateNewWalletSignersDescriptions } =
    api.wallet.updateNewWalletSignersDescriptions.useMutation({
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

  async function changeSignerName() {
    if (newWallet === undefined || newWallet === null)
      throw new Error("Wallet invite is undefined");
    if (userAddress === undefined) throw new Error("User address is undefined");

    const userIndex = newWallet.signersAddresses.findIndex((item) => item === userAddress)
    if (userIndex === undefined) throw new Error("User index is undefined");

    setLoading(true);
    
    var newsignersDescription = newWallet.signersDescriptions;
    newsignersDescription[userIndex] = signersDescription;
    
    updateNewWalletSignersDescriptions({
      walletId: newWalletId!,
      signersDescriptions: newsignersDescription,
    });
  }

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
  
    async function removeSigner() {
      if (newWallet === undefined || newWallet === null)
        throw new Error("Wallet invite is undefined");
      if (userAddress === undefined) throw new Error("User address is undefined");
  
      const userIndex = newWallet.signersAddresses.findIndex((item) => item === userAddress)
      if (userIndex === -1) throw new Error("User index is not found");
  
      setLoading(true);
  
      const updatedAddresses = newWallet.signersAddresses.filter((_, i) => i !== userIndex);
      const updatedStakeKeys = newWallet.signersStakeKeys.filter((_, i) => i !== userIndex);
      const updatedDescriptions = newWallet.signersDescriptions.filter((_, i) => i !== userIndex);

      updateNewWalletSigners({
        walletId: newWalletId!,
        signersAddresses: updatedAddresses,
        signersStakeKeys: updatedStakeKeys,
        signersDescriptions: updatedDescriptions,
      });
    }

  return (
    <>
      <PageHeader
        pageTitle={`Invited as Signer${newWallet ? ` for: ${newWallet.name}` : ""}`}
      ></PageHeader>
      {newWallet && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>You are invited as Signer</CardTitle>
              <CardDescription>
                You are invited to be a signer of this multi-siganture wallet. Please confirm
                your address and change your name in this wallet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="address">Your Paymentaddress</Label>
                  <Input
                    id="address"
                    type="text"
                    className="w-full"
                    value={userAddress}
                    disabled
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="Stakeaddress">Your Stakeaddress</Label>
                  <Input
                    id="Stakeaddress"
                    type="text"
                    className="w-full"
                    value={user?.stakeAddress ?? ""}
                    disabled
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="description">Your Name</Label>
                  <Input
                    id="description"
                    type="text"
                    className="w-full"
                    placeholder={newWallet.signersDescriptions[newWallet.signersAddresses.findIndex((item) => item === userAddress)]}
                    value={signersDescription}
                    onChange={(e) => setSignerDescription(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div></div>

          <div className="flex gap-4">
            <Button
              onClick={changeSignerName}
              disabled={loading}
            >
              {loading ? "Changeing..." : "Change my Name"}
            </Button>

            <Button
              onClick={removeSigner}
              disabled={loading}
            >
              {loading ? "Changeing..." : "Remove from pending Wallet"}
            </Button>
          </div>



        </div>
        
      )}
    </>
  );
}
