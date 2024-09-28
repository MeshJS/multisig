import Button from "@/components/common/button";
import CardUI from "@/components/common/card-content";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wallet } from "@/types/wallet";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EditWallet({ appWallet }: { appWallet: Wallet }) {
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
    <CardUI
      title="Edit Wallet"
      description="Edit the wallet's metadata"
      icon={Pencil}
      cardClassName="col-span-2"
    >
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
        <div>
          <Button
            onClick={() => editWallet()}
            disabled={
              loading ||
              (appWallet.name === name && appWallet.description === description)
            }
          >
            {loading ? "Updating Wallet..." : "Update"}
          </Button>
        </div>
      </fieldset>
    </CardUI>
  );
}
