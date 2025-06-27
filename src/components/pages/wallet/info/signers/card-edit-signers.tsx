import { useMemo, useState } from "react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { checkValidAddress, checkValidStakeKey } from "@/utils/multisigSDK";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import useUser from "@/hooks/useUser";

interface EditSignersProps {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}

export default function EditSigners({
  appWallet,
  setShowEdit,
}: EditSignersProps) {
  const signersAddresses = appWallet.signersAddresses;
  const signersStakeKeys = appWallet.signersStakeKeys ?? [];
  const [signersDescriptions, setSignerDescription] = useState<string[]>(
    appWallet.signersDescriptions,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();

  const { mutate: updateWalletSignersDescriptions } =
    api.wallet.updateWalletSignersDescriptions.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet Info Updated",
          description: "The wallet's metadata has been updated",
          duration: 5000,
        });
        setLoading(false);
        await ctx.wallet.getWallet.invalidate({
          address: userAddress,
          walletId: appWallet.id,
        });
        setShowEdit(false);
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  function update() {
    setLoading(true);
    updateWalletSignersDescriptions({
      walletId: appWallet.id,
      signersDescriptions: signersDescriptions,
      signersStakeKeys: updatedStakeKeys,
    });
  }

  const updatedStakeKeys = useMemo(() => {
    const skList: string[] = Array(signersAddresses.length).fill("");
    for (let i = 0; i < signersAddresses.length; i++) {
      const stakeAddr = user?.stakeAddress;
      if (
        signersAddresses[i] === userAddress &&
        stakeAddr !== undefined &&
        !signersStakeKeys?.[i]
      ) {
        skList[i] = stakeAddr;
      } else {
        skList[i] = signersStakeKeys[i] ?? "";
      }
    }
    return skList;
  }, [signersAddresses, signersStakeKeys, userAddress, user?.stakeAddress]);

  const newStakekey = (index: number) => {
    const stakeAddr = user?.stakeAddress;
    return (
      signersAddresses[index] === userAddress &&
      stakeAddr !== undefined &&
      signersStakeKeys[index] !== stakeAddr
    );
  };

  return (
    <>
      <Table>
        <TableBody>
          {signersAddresses.map((signer, index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label className="text-right mt-2">Address</Label>
                    <textarea
                      placeholder="addr1..."
                      className={`col-span-3 flex min-h-[36px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${
                        signersAddresses[index] !== "" &&
                        !checkValidAddress(signersAddresses[index]!) &&
                        "text-red-500"
                      }`}
                      value={signer}
                      disabled
                      rows={1}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = target.scrollHeight + 'px';
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label className="text-right mt-2">Stake Address</Label>
                    <textarea
                      placeholder="stake..."
                      className={`col-span-3 flex min-h-[36px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${newStakekey(index) && "text-green-500"}`}
                      value={
                        signersAddresses[index] === userAddress
                          ? user?.stakeAddress ?? ""
                          : signersStakeKeys[index] ?? ""
                      }
                      disabled
                      rows={1}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = target.scrollHeight + 'px';
                      }}
                    />
                  </div>
                  {newStakekey(index) && (
                    <Label className="text-right">
                      Click Update to add your stake key to the multisig wallet.
                    </Label>
                  )}
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Description</Label>
                    <Input
                      className="col-span-3"
                      value={signersDescriptions[index]}
                      onChange={(e) => {
                        const newSigners = [...signersDescriptions];
                        newSigners[index] = e.target.value;
                        setSignerDescription(newSigners);
                      }}
                      placeholder="optional name or description of this signer"
                    />
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-4">
        <Button onClick={update} disabled={loading}>
          {loading ? "Updating Wallet..." : "Update"}
        </Button>
        <Button onClick={() => setShowEdit(false)} variant="destructive">
          Cancel
        </Button>
      </div>
    </>
  );
}
