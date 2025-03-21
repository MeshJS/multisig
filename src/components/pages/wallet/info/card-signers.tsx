import { Check, MoreVertical, X } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import {
  checkSignature,
  generateNonce,
  resolvePaymentKeyHash,
} from "@meshsdk/core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  const [showEdit, setShowEdit] = useState(false);

  return (
    <CardUI
      title="Signers"
      description={
        <>
          This wallet requires{" "}
          <b className="text-white">{appWallet.numRequiredSigners}</b> signers
          to sign a transaction.
        </>
      }
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setShowEdit(!showEdit)}
            >
              {showEdit ? "Close Edit" : "Edit Signer Descriptions"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2"
    >
      {showEdit ? (
        <EditSigners
          appWallet={appWallet}
          setShowEdit={setShowEdit}
        />
      ) : (
        <ShowSigners appWallet={appWallet} />
      )}
    </CardUI>
  );
}

function EditSigners({
  appWallet,
  setShowEdit,
}: {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}) {
  const signersAddresses = appWallet.signersAddresses;
  const [signersDescriptions, setSignerDescription] = useState<string[]>(
    appWallet.signersDescriptions,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: updateWalletSignersDescriptions } =
    api.wallet.updateWalletSignersDescriptions.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet Info Updated",
          description: "The wallet's metadata has been updated",
          duration: 5000,
        });
        setLoading(false);
        void ctx.wallet.getWallet.invalidate({
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

  function checkValidAddress(address: string) {
    try {
      resolvePaymentKeyHash(address);
      return true;
    } catch (e) {
      return false;
    }
  }

  function update() {
    setLoading(true);
    updateWalletSignersDescriptions({
      walletId: appWallet.id,
      signersDescriptions: signersDescriptions,
    });
  }

  return (
    <>
      <Table>
        <TableBody>
          {signersAddresses.map((signer, index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Address</Label>
                    <Input
                      type="string"
                      placeholder="addr1..."
                      className={`col-span-3 ${
                        signersAddresses[index] != "" &&
                        !checkValidAddress(signersAddresses[index]!) &&
                        "text-red-500"
                      }`}
                      value={signer}
                      disabled={true}
                    />
                  </div>
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

function ShowSigners({ appWallet }: { appWallet: Wallet }) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: updateWalletVerifiedList } =
    api.wallet.updateWalletVerifiedList.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet verified",
          description: "You have successfully verified this wallet",
          duration: 5000,
        });
        void ctx.wallet.getWallet.invalidate({
          address: userAddress,
          walletId: appWallet.id,
        });
      },
      onError: (e) => {
        console.error(e);
      },
    });

  async function signVerify() {
    if (!userAddress) throw new Error("User address not found");
    if (!connected) throw new Error("Wallet not connected");

    const userRewardAddress = (await wallet.getRewardAddresses())[0];
    const nonce = generateNonce("Verify this wallet: ");
    const signature = await wallet.signData(nonce, userRewardAddress);
    const result = await checkSignature(nonce, signature);

    if (result) {
      const _verified = appWallet.verified;
      _verified.push(userAddress);

      updateWalletVerifiedList({
        walletId: appWallet.id,
        verified: _verified,
      });
    }
  }

  return (
    <>
      {appWallet.signersAddresses.map((address, index) => (
        <RowLabelInfo
          label={
            appWallet.signersDescriptions[index] &&
            appWallet.signersDescriptions[index].length > 0
              ? appWallet.signersDescriptions[index]
              : `Signer ${index + 1}`
          }
          value={getFirstAndLast(address)}
          copyString={address}
          key={address}
        >
          <>
            {appWallet.verified.includes(address) ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Check className="h-4 w-4 text-green-400" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This address has been verified.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <>
                {userAddress && address == userAddress ? (
                  <Button size="sm" onClick={() => signVerify()}>
                    Verify
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <X className="h-4 w-4 text-red-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>This address has not been verified.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </>
            )}
          </>
        </RowLabelInfo>
      ))}
    </>
  );
}
