import { useState } from "react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { api } from "@/utils/api";
// import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";

interface ClarityCardProps {
  appWallet: Wallet;
}

export default function ClarityCard({ appWallet }: ClarityCardProps) {
  const [clarityOrgId, setClarityOrgId] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const { mutate: updateClarityOrgId } =
    api.wallet.updateWalletClarityOrgId.useMutation({
      onSuccess: () => {
        setIsEditing(false);
      },
    });

  const handleSave = () => {
    if (clarityOrgId.trim()) {
      updateClarityOrgId({
        walletId: appWallet.id,
        clarityOrgId: clarityOrgId.trim(),
      });
    }
  };

  return (
    <CardUI title="Clarity Governance" cardClassName="col-span-2">
      <div className="flex flex-col space-y-4 p-2">
        {appWallet.clarityOrgId ? (
          <div className="flex flex-col space-y-4">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">
                Clarity Organization ID:
              </span>
              <span className="text-sm">{appWallet.clarityOrgId}</span>
              {/* <CheckCircleIcon className="h-5 w-5 text-green-500" /> */}
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
            <label htmlFor="clarityOrgId" className="text-sm font-medium">
              Enter your Clarity Organization ID found in the URL of your
              Organization on Clarity:
            </label>
            <div className="flex items-center space-x-2">
              <Input
                id="clarityOrgId"
                value={clarityOrgId}
                onChange={(e) => setClarityOrgId(e.target.value)}
                placeholder="Enter Clarity Org ID"
                className="flex-1"
              />
              <Button onClick={handleSave} disabled={!clarityOrgId.trim()}>
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
              No Clarity Organization ID associated with this wallet.
            </p>
            <div>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Link2Icon className="mr-2 h-4 w-4" /> Link Clarity Organization
              </Button>
            </div>
          </div>
        )}
      </div>
    </CardUI>
  );
}
