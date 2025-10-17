import { useState } from "react";
import { Wallet } from "@/types/wallet";
import { MoreVertical } from "lucide-react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import useMultisigWallet from "@/hooks/useMultisigWallet";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/ui/row-label-info";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const [showEdit, setShowEdit] = useState(false);

  return (
    <CardUI
      title="About This Wallet"
      description={appWallet.description}
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEdit(!showEdit)}>
              {showEdit ? "Close Edit" : "Edit Wallet"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2"
    >
      {showEdit ? (
        <EditInfo appWallet={appWallet} setShowEdit={setShowEdit} />
      ) : (
        <ShowInfo appWallet={appWallet} />
      )}
    </CardUI>
  );
}

function EditInfo({
  appWallet,
  setShowEdit,
}: {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}) {
  const [name, setName] = useState<string>(appWallet.name);
  const [description, setDescription] = useState<string>(
    appWallet.description ?? "",
  );
  const [isArchived, setIsArchived] = useState<boolean>(appWallet.isArchived);
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: updateWalletMetadata } = api.wallet.updateWallet.useMutation({
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

  async function editWallet() {
    setLoading(true);
    updateWalletMetadata({
      walletId: appWallet.id,
      name,
      description,
      isArchived,
    });
  }
  return (
    <fieldset className="grid gap-6">
      <div className="grid gap-3">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          className="w-full"
          placeholder="Fund12 Project X"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-3">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          className="min-h-32"
          placeholder="For managing Fund12 Project X catalyst fund / dRep for team X / Company X main spending wallet"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-3">
        <Label htmlFor="type">
          Mark wallet as archived (will not be displayed in the wallet list)
        </Label>
        <Select
          value={isArchived ? "true" : "false"}
          onValueChange={(value) =>
            setIsArchived(value === "true" ? true : false)
          }
          defaultValue={"false"}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="false">
                Show this wallet in the wallet list
              </SelectItem>
              <SelectItem value="true">Archive this wallet</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-4">
        <Button
          onClick={() => editWallet()}
          disabled={
            loading ||
            (appWallet.name === name && appWallet.description === description)
          }
        >
          {loading ? "Updating Wallet..." : "Update"}
        </Button>
        <Button onClick={() => setShowEdit(false)} variant="destructive">
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function ShowInfo({ appWallet }: { appWallet: Wallet }) {
  const { multisigWallet } = useMultisigWallet();
  
  // Get DRep ID from multisig wallet if available, otherwise fallback to appWallet
  const dRepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
  if (!dRepId) {
    throw new Error("DRep not found");
  }
  
  return (
    <>
      <RowLabelInfo
        label="Address"
        value={appWallet.address}
        copyString={appWallet.address}
      />
      <RowLabelInfo
        label="DRep ID"
        value={dRepId}
        copyString={dRepId}
      />
    </>
  );
}
