import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAppWallet from "@/hooks/useAppWallet";
import {
  deserializePoolId,
  keepRelevant,
  type Quantity,
  resolveScriptHash,
  serializeRewardAddress,
  type Unit,
} from "@meshsdk/core";
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
import { set } from "idb-keyval";

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
        policyId: asset.unit,
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
      }
    > = {};

    console.log("reconfiguring assets with amounts", assets, amounts);

    // reduce assets and amounts to Asset: Amount object
    for (let i = 0; i < assets.length; i++) {
      const name = assets[i] ?? "";
      if (name === "ADA") {
        if (assetsAmounts.lovelace) {
          assetsAmounts.lovelace.amount += Number(amounts[i]) ?? 0;
        } else {
          assetsAmounts.lovelace = {
            amount: Number(amounts[i]) ?? 0,
            assetName: "ADA",
            decimals: 6,
          };
        }
      } else {
        if (assetsAmounts[name]) {
          assetsAmounts[name].amount += Number(amounts[i]) ?? 0;
        } else {
          const assetName = userWalletAssets.find(
            (asset) => asset.policyId === name,
          )?.assetName;
          assetsAmounts[name] = {
            amount: Number(amounts[i]) ?? 0,
            assetName: assetName ?? name,
            decimals: userAssetMetadata[name]?.decimals ?? 0,
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
      let totalAmount = 0;
      const outputs: { address: string; amount: string }[] = [];
      for (let i = 0; i < UTxoCount; i++) {
        //fix

        if (address && address.startsWith("addr") && address.length > 0) {
          const thisAmount = parseFloat(amounts[i]!) * 1000000;
          totalAmount += thisAmount;
          outputs.push({
            address: address,
            amount: thisAmount.toString(),
          });
        }
      }

      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);

      let selectedUtxos = utxos;

      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", totalAmount.toString());
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

      for (let i = 0; i < outputs.length; i++) {
        txBuilder.txOut(outputs[i]!.address, [
          {
            unit: "lovelace",
            quantity: outputs[i]!.amount,
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
