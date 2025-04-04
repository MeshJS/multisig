import { useState } from "react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { api } from "@/utils/api";
// import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircleIcon, Link2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";

interface ClarityCardProps {
  appWallet: Wallet;
}

export default function ClarityCard({ appWallet }: ClarityCardProps) {
  const [newApiKey, setNewApiKey] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const { mutate: updateClarityApiKey } =
    api.wallet.updateWalletClarityApiKey.useMutation({
      onSuccess: () => {
        setIsEditing(false);
      },
    });

  const handleSave = () => {
    if (newApiKey.trim()) {
      updateClarityApiKey({
        walletId: appWallet.id,
        clarityApiKey: newApiKey.trim(),
      });
    }
  };

  return (
    <CardUI title="Clarity Governance" cardClassName="col-span-2">
      <div className="flex flex-col space-y-4 p-2">
        {appWallet.clarityApiKey ? (
          <div className="flex flex-col space-y-4">
            <div className="flex items-center space-x-2">
              <span className="font-medium">Clarity API:</span>
              <CheckCircleIcon className="h-5 w-5 text-green-500" />
              <span>Connected</span>
            </div>
            <div>
              <Link
                href={`/wallets/${appWallet.id}/governance/clarity/create-action`}
              >
                <Button>
                  <PlusIcon className="mr-2 h-4 w-4" /> New Governance Action
                </Button>
              </Link>
            </div>
          </div>
        ) : isEditing ? (
          <div className="flex flex-col space-y-2">
            <label htmlFor="clarityApiKey" className="text-sm font-medium">
              Enter your Clarity API Key found on the Admin Page of your
              Organization on Clarity:
            </label>
            <div className="flex items-center space-x-2">
              <Input
                id="clarityApiKey"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Enter Clarity API Key"
                className="flex-1"
              />
              <Button onClick={handleSave} disabled={!newApiKey.trim()}>
                Save
              </Button>
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col space-y-2">
            <p className="text-sm text-gray-500">
              No Clarity API Key associated with this wallet.
            </p>
            <div>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Link2Icon className="mr-2 h-4 w-4" /> Link Clarity API Key
              </Button>
            </div>
          </div>
        )}
      </div>
    </CardUI>
  );
}
