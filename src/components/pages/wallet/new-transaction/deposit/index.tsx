import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAppWallet from "@/hooks/useAppWallet";
import { keepRelevant, type Quantity, type Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, PlusCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useUserStore } from "@/lib/zustand/user";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import CardUI from "@/components/common/card-content";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";
import { cn } from "@/lib/utils";

export default function PageNewTransaction() {
  const { connected, wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
  const [metadata, setMetadata] = useState<string>("");
  const [sendAllAssets, setSendAllAssets] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [UTxoCount, setUTxoCount] = useState<number>(3);
  const [amounts, setAmounts] = useState<string[]>(["100", "100", "100"]);
  const [assets, setAssets] = useState<string[]>(["ADA", "ADA", "ADA"]);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { toast } = useToast();
  const router = useRouter();
  const userAssets = useUserStore((state) => state.userAssets);
  const userAssetMetadata = useUserStore((state) => state.userAssetMetadata);

  useEffect(() => {
    reset();
  }, []);

  const userBalance = useMemo(() => {
    const lovelace =
      userAssets.find((asset) => asset.unit === "lovelace")?.quantity || 0;
    return Number(lovelace) / Math.pow(10, 6);
  }, [userAssets]);

  function reset() {
    setMetadata("");
    setSendAllAssets(false);
    setLoading(false);
  }

  const userWalletAssets = useMemo(() => {
    return userAssets.map((asset) => {
      return {
        unit: asset.unit,
        assetName: userAssetMetadata[asset.unit]?.assetName,
        decimals: userAssetMetadata[asset.unit]?.decimals ?? 0,
        amount: asset.quantity,
      };
    });
  }, [userAssets, userAssetMetadata]);

  const assetsWithAmounts = useMemo(() => {
    const assetsAmounts: Record<
      string,
      {
        amount: number;
        assetName: string;
        decimals: number;
        unit: string;
      }
    > = {};

    // reduce assets and amounts to Asset: Amount object
    for (let i = 0; i < assets.length; i++) {
      const unit = assets[i] ?? "";
      if (unit === "ADA") {
        if (assetsAmounts.lovelace) {
          assetsAmounts.lovelace.amount += Number(amounts[i]) ?? 0;
        } else {
          assetsAmounts.lovelace = {
            amount: Number(amounts[i]) ?? 0,
            assetName: "ADA",
            decimals: 6,
            unit: "lovelace",
          };
        }
      } else {
        if (assetsAmounts[unit]) {
          assetsAmounts[unit].amount += Number(amounts[i]) ?? 0;
        } else {
          const asset = userWalletAssets.find((asset) => asset.unit === unit);
          assetsAmounts[unit] = {
            amount: Number(amounts[i]) ?? 0,
            assetName: asset?.assetName ?? unit,
            decimals: userAssetMetadata[unit]?.decimals ?? 0,
            unit: asset?.unit ?? "",
          };
        }
      }
    }
    return assetsAmounts;
  }, [amounts, assets, userWalletAssets, userAssetMetadata]);

  const assetAmountList = useMemo(() => {
    return (
      <>
        {Object.entries(assetsWithAmounts).map(([name, asset]) => {
          return (
            <div key={name} className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">
                {asset.amount.toLocaleString(undefined, {
                  maximumFractionDigits: asset.decimals ? asset.decimals : 6,
                })}{" "}
                {asset.assetName}
              </div>
            </div>
          );
        })}
      </>
    );
  }, [assetsWithAmounts]);

  async function createNewDeposit() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");
    const address = appWallet.address;
    setLoading(true);
    setError(undefined);

    try {
      const outputs: { address: string; unit: string; amount: string }[] = [];
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);
      let selectedUtxos = utxos;
      const assetMap = new Map<Unit, Quantity>();

      for (let i = 0; i < UTxoCount; i++) {
        if (address && address.startsWith("addr") && address.length > 0) {
          const unit = assets[i] === "ADA" ? "lovelace" : assets[i]!;
          const assetMetadata = userAssetMetadata[unit];
          const multiplier =
            unit === "lovelace"
              ? 1000000
              : Math.pow(10, assetMetadata?.decimals ?? 0);
          const thisAmount = parseFloat(amounts[i]!) * multiplier;
          outputs.push({
            address: address,
            unit: unit,
            amount: thisAmount.toString(),
          });
          assetMap.set(
            unit,
            (Number(assetMap.get(unit) || 0) + thisAmount).toString(),
          );
        }
      }

      selectedUtxos = keepRelevant(assetMap, utxos);

      if (selectedUtxos.length === 0) {
        setError(
          "Insufficient funds, no UTxOs were found in the depositors wallet",
        );
        return;
      }

      const txBuilder = getTxBuilder(network);

      for (const utxo of selectedUtxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
      }
      for (const output of outputs) {
        txBuilder.txOut(output.address, [
          {
            unit: output.unit,
            quantity: output.amount,
          },
        ]);
      }
      const unsignedTx = await txBuilder.changeAddress(userAddress).complete();
      const signedTx = await wallet.signTx(unsignedTx);
      const txHash = await wallet.submitTx(signedTx);

      toast({
        title: "Transaction Created",
        description: txHash ?? "Your transaction has been created",
        duration: 10000,
      });

      reset();
      router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (e) {
      setLoading(false);

      toast({
        title: "Error",
        description: `${JSON.stringify(e)}`,
        duration: 10000,
        action: (
          <ToastAction
            altText="Try again"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(e));
              toast({
                title: "Error Copied",
                description: `Error has been copied to your clipboard.`,
                duration: 5000,
              });
            }}
          >
            Copy Error
          </ToastAction>
        ),
        variant: "destructive",
      });
    }
  }

  function addNewUTxO() {
    setUTxoCount(UTxoCount + 1);
    setAmounts([...amounts, "100"]);
    setAssets([...assets, "ADA"]);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <SectionTitle>Deposit</SectionTitle>

      <CardUI
        title="Wallet Details"
        description="User wallet balance for Address:"
        cardClassName="w-full"
      >
        <p>
          {userAddress?.slice(0, 15)} ...{" "}
          {userAddress?.slice(userAddress.length - 8, userAddress.length)} :{" "}
          {userBalance} ₳
        </p>
      </CardUI>

      <CardUI
        title="UTxOs"
        description="Set up a variety of UTxO (Unspent Transaction Outputs) to enable parallel transaction processing.
        It is recomended to have at least 3 UTxOs holding at least one ADA."
        cardClassName="w-full"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>UTxO</TableHead>
              <TableHead className="w-[120px]">Amount</TableHead>
              <TableHead className="w-[120px]">Asset</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {amounts.map((_, index) => (
              <UTxORow
                key={index}
                index={index}
                amounts={amounts}
                setAmounts={setAmounts}
                assets={assets}
                setAssets={setAssets}
                disableAdaAmountInput={sendAllAssets}
              />
            ))}
            <TableRow>
              <TableCell colSpan={1}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => addNewUTxO()}
                  disabled={sendAllAssets}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Add UTxO
                </Button>
              </TableCell>
              <TableCell colSpan={2}>
                Total Deposit: {assetAmountList}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <CardUI
        title="On-chain Metadata"
        description="Metadata attaches additional information to a transaction viewable on the blockchain."
        cardClassName="w-full"
      >
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <Textarea
                  className="min-h-16"
                  value={metadata}
                  onChange={(e) => {
                    if (e.target.value.length <= 64)
                      setMetadata(e.target.value);
                  }}
                  placeholder={`PR #123`}
                />
                {metadata.length >= 64 && (
                  <p className="text-red-500">
                    Metadata should be less than 64 characters
                  </p>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <div className="flex h-full items-center justify-center gap-4">
        <Button onClick={() => createNewDeposit()} disabled={loading}>
          {loading ? (
            <Loader className="mr-2 h-4 w-4" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Create and Sign Transaction
        </Button>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
    </main>
  );
}

function UTxORow({
  index,
  amounts,
  setAmounts,
  assets,
  setAssets,
  disableAdaAmountInput,
}: {
  index: number;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  assets: string[];
  setAssets: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}) {
  const userAssets = useUserStore((state) => state.userAssets);
  const userAssetMetadata = useUserStore((state) => state.userAssetMetadata);

  const userWalletAssets = useMemo(() => {
    return userAssets.map((asset) => {
      return {
        policyId: asset.unit,
        assetName: userAssetMetadata[asset.unit]?.assetName,
        decimals: userAssetMetadata[asset.unit]?.decimals ?? 0,
        amount: asset.quantity,
      };
    });
  }, [userAssets, userAssetMetadata]);

  const assetOptions = useMemo(() => {
    return (
      <>
        {userWalletAssets.map((userWalletAsset) => {
          return (
            <option
              key={userWalletAsset.policyId}
              value={userWalletAsset.policyId}
            >
              {userWalletAsset.policyId === "lovelace"
                ? "ADA"
                : userWalletAsset.assetName}
            </option>
          );
        })}
      </>
    );
  }, [userWalletAssets]);

  return (
    <TableRow>
      <TableCell>
        <div className="text-sm text-muted-foreground">{index + 1}</div>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={amounts[index]}
          onChange={(e) => {
            const newAmounts = [...amounts];
            newAmounts[index] = e.target.value;
            setAmounts(newAmounts);
          }}
          placeholder=""
          disabled={disableAdaAmountInput}
        />
      </TableCell>
      <TableCell className="w-[240px]">
        <select
          value={assets[index]}
          onChange={(e) => {
            const newAssets = [...assets];
            newAssets[index] = e.target.value;
            setAssets(newAssets);
          }}
          disabled={disableAdaAmountInput}
          className={cn(
            "flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:placeholder:text-zinc-400 dark:focus-visible:ring-zinc-300",
          )}
        >
          {assetOptions}
        </select>
      </TableCell>
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            // remove amount
            const newAmounts = [...amounts];
            newAmounts.splice(index, 1);
            setAmounts(newAmounts);

            // remove asset
            const newAssets = [...assets];
            newAssets.splice(index, 1);
            setAssets(newAssets);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
