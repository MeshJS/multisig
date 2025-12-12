import { useState } from "react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { api } from "@/utils/api";
// import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircleIcon, Link2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useUserStore } from "@/lib/zustand/user";
import { toast } from "@/hooks/use-toast";

interface ClarityCardProps {
  appWallet: Wallet;
}

export default function ClarityCard({ appWallet }: ClarityCardProps) {
  const [newApiKey, setNewApiKey] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const ctx = api.useUtils();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: updateClarityApiKey, mutateAsync: updateClarityApiKeyAsync } =
    api.wallet.updateWalletClarityApiKey.useMutation({
      onSuccess: () => {
        setIsEditing(false);
      },
    });

  const handleSave = async () => {
    if (newApiKey.trim()) {
      setIsSaving(true);
      await updateClarityApiKeyAsync({
        walletId: appWallet.id,
        clarityApiKey: newApiKey.trim(),
      });
      toast({
        title: "Clarity API Key Updated",
        description: "The Clarity API key has been updated",
        duration: 5000,
      });
      setIsSaving(false);
      void ctx.wallet.getWallet.invalidate({
        address: userAddress,
        walletId: appWallet.id,
      });
    }
  };

  return (
    <CardUI title="Clarity Governance" cardClassName="col-span-2">
      <div className="flex flex-col space-y-3 sm:space-y-4 p-2 sm:p-4">
        {appWallet.clarityApiKey ? (
          <div className="flex flex-col space-y-3 sm:space-y-4">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm sm:text-base">Clarity API:</span>
              <CheckCircleIcon className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 flex-shrink-0" />
              <span className="text-sm sm:text-base">Connected</span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2">
              <Link
                href={`/wallets/${appWallet.id}/governance/clarity/create-action`}
                className="flex-1 sm:flex-initial"
              >
                <Button className="w-full sm:w-auto text-sm sm:text-base">
                  <PlusIcon className="mr-2 h-4 w-4" /> New Governance Action
                </Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => setIsEditing(true)}
                disabled={isSaving}
                className="w-full sm:w-auto text-sm sm:text-base"
              >
                Update Clarity API Key
              </Button>
            </div>
          </div>
        ) : isEditing ? (
          <div className="flex flex-col space-y-3 sm:space-y-4">
            <label htmlFor="clarityApiKey" className="text-xs sm:text-sm font-medium">
              Enter your Clarity API Key found on the Admin Page of your
              Organization on Clarity:
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="clarityApiKey"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Enter Clarity API Key"
                className="flex-1 text-sm sm:text-base"
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!newApiKey.trim() || isSaving}
                  className="flex-1 sm:flex-initial text-sm sm:text-base"
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  className="flex-1 sm:flex-initial text-sm sm:text-base"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col space-y-3 sm:space-y-4">
            <p className="text-xs sm:text-sm text-gray-500">
              No Clarity API Key associated with this wallet.
            </p>
            <div>
              <Button
                variant="outline"
                onClick={() => setIsEditing(true)}
                disabled={isSaving}
                className="w-full sm:w-auto text-sm sm:text-base"
              >
                <Link2Icon className="mr-2 h-4 w-4" /> Link Clarity API Key
              </Button>
            </div>
          </div>
        )}
      </div>
    </CardUI>
  );
}
