import { useState, useEffect, useMemo } from "react";
import { Wallet } from "@/types/wallet";
import { MoreVertical, Coins, TrendingUp } from "lucide-react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";

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
import { getProvider } from "@/utils/get-provider";
import { useSiteStore } from "@/lib/zustand/site";

interface AddressInfo {
  address: string;
  amount: Array<{
    unit: string;
    quantity: string;
  }>;
  stake_address?: string;
  type: string;
  script: boolean;
}

interface StakingInfo {
  stake_address: string;
  active: boolean;
  active_epoch: number;
  controlled_amount: string;
  rewards_sum: string;
  withdrawals_sum: string;
  reserves_sum: string;
  treasury_sum: string;
  withdrawable_amount: string;
  pool_id?: string;
  drep_id?: string;
}

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
  return (
    <>
      <RowLabelInfo
        label="Address"
        value={appWallet.address}
        copyString={appWallet.address}
      />
      <RowLabelInfo
        label="DRep ID"
        value={appWallet.dRepId}
        copyString={appWallet.dRepId}
      />
      <BalanceAndStakingInfo address={appWallet.address} />
    </>
  );
}

function BalanceAndStakingInfo({ address }: { address: string }) {
  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null);
  const [stakingInfo, setStakingInfo] = useState<StakingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const network = useSiteStore((state) => state.network);
  
  // Memoize the blockchain provider to prevent infinite re-renders
  const blockchainProvider = useMemo(() => getProvider(network), [network]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch address information
        const addressData = await blockchainProvider.get(`/addresses/${address}`) as AddressInfo;
        setAddressInfo(addressData);

        // If there's a stake address, fetch staking information
        if (addressData.stake_address) {
          try {
            const stakingData = await blockchainProvider.get(`/accounts/${addressData.stake_address}`) as StakingInfo;
            setStakingInfo(stakingData);
          } catch (stakingError) {
            console.warn("Could not fetch staking info:", stakingError);
            // Don't set error for staking info failure, just log it
          }
        }
      } catch (err) {
        console.error("Error fetching address data:", err);
        setError("Failed to load balance information");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [address, blockchainProvider]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Coins className="h-4 w-4" />
          <span>Loading balance...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-red-500">
          <Coins className="h-4 w-4" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!addressInfo) {
    return null;
  }

  // Find ADA balance (lovelace)
  const adaAmount = addressInfo.amount.find(asset => asset.unit === "lovelace");
  const adaBalance = adaAmount ? (parseInt(adaAmount.quantity) / 1000000).toFixed(2) : "0.00";

  return (
    <div className="space-y-3">
      {/* Balance Information */}
      <div className="flex items-center gap-2 text-sm">
        <Coins className="h-4 w-4 text-blue-500" />
        <span className="text-muted-foreground">Balance:</span>
        <span className="font-mono font-medium">{adaBalance} ADA</span>
      </div>

      {/* Additional Assets */}
      {addressInfo.amount.length > 1 && (
        <div className="text-xs text-muted-foreground">
          +{addressInfo.amount.length - 1} other asset{addressInfo.amount.length > 2 ? 's' : ''}
        </div>
      )}

      {/* Staking Information */}
      {stakingInfo && (
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Staking:</span>
            <span className={`font-medium ${stakingInfo.active ? 'text-green-600' : 'text-orange-500'}`}>
              {stakingInfo.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          
          {stakingInfo.active && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Withdrawable: {(parseInt(stakingInfo.withdrawable_amount) / 1000000).toFixed(2)} ADA</div>
              {stakingInfo.pool_id && (
                <div>Pool: {stakingInfo.pool_id.slice(0, 20)}...</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
