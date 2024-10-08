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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  NativeScript,
  resolvePaymentKeyHash,
  serializeNativeScript,
} from "@meshsdk/core";
import { PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import { stakeCredentialHash } from "@/data/cardano";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function PageWalletInvite() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [signersDescription, setSignerDescription] = useState<string>("");
  const userAddress = useUserStore((state) => state.userAddress);
  const { toast } = useToast();

  const pathIsWalletInvite = router.pathname == "/wallets/invite/[id]";
  const walletInviteId = pathIsWalletInvite
    ? (router.query.id as string)
    : undefined;

  const { data: walletInvite } = api.wallet.getWalletInvite.useQuery(
    { walletId: walletInviteId! },
    {
      enabled: pathIsWalletInvite && walletInviteId !== undefined,
    },
  );

  const { mutate: updateWalletInviteSigners } =
    api.wallet.updateWalletInviteSigners.useMutation({
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
    if (walletInvite === undefined || walletInvite === null)
      throw new Error("Wallet invite is undefined");
    if (userAddress === undefined) throw new Error("User address is undefined");

    setLoading(true);

    updateWalletInviteSigners({
      walletId: walletInviteId!,
      signersAddresses: [...walletInvite.signersAddresses, userAddress],
      signersDescriptions: [
        ...walletInvite.signersDescriptions,
        signersDescription,
      ],
    });
  }

  return (
    <>
      <PageHeader pageTitle="Invited as Signer Wallet"></PageHeader>
      {walletInvite && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>You are invited as Signer</CardTitle>
              <CardDescription>
                You are invited to be a signer of this wallet. Please confirm
                your address and add a description.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="address">Your address</Label>
                  <Input
                    id="address"
                    type="text"
                    className="w-full"
                    value={userAddress}
                    disabled
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    type="text"
                    className="w-full"
                    placeholder="your name or a description about this signer"
                    value={signersDescription}
                    onChange={(e) => setSignerDescription(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Wallet Info</CardTitle>
              <CardDescription>
                Some information to help you remember what is this wallet use
                for
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    className="w-full"
                    value={walletInvite.name}
                    disabled
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    className="min-h-32"
                    value={walletInvite.description ?? ""}
                    disabled
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button onClick={addSigner} disabled={loading}>
              {loading ? "Adding..." : "Add me as signer"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
