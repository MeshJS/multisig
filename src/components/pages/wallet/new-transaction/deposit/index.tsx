import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAppWallet from "@/hooks/useAppWallet";
import { deserializePoolId, keepRelevant, Quantity, resolveScriptHash, serializeRewardAddress, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, PlusCircle, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
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

export default function PageNewTransaction() {
  const { connected, wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
  const [metadata, setMetadata] = useState<string>("");
  const [sendAllAssets, setSendAllAssets] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [UTxoCount, setUTxoCount] = useState<number>(3);
  const [amounts, setAmounts] = useState<string[]>(["100", "100", "100"]);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { toast } = useToast();
  const [userBalance, setUserBalance] = useState<number>(0);
  const router = useRouter();

  useEffect(() => {
    if (userAddress) {
      fetchUTxOsAndBalance();
    }
  }, [userAddress]);

  async function fetchUTxOsAndBalance() {
    if (!userAddress) return;
    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);

      // Calculate the total balance
      const balance = utxos.reduce((sum, utxo) => {
        const lovelaceAmount = utxo.output.amount.find(
          (amt) => amt.unit === "lovelace",
        );
        return (
          sum + (lovelaceAmount ? parseInt(lovelaceAmount.quantity, 10) : 0)
        );
      }, 0);

      // Convert from lovelace to ADA
      setUserBalance(balance / 1_000_000);
    } catch (error) {
      console.error("Error fetching UTXOs or calculating balance:", error);
    }
  }

  useEffect(() => {
    reset();
  }, []);

  function reset() {
    setMetadata("");
    setSendAllAssets(false);
    setLoading(false);
  }
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
          const thisAmount = parseFloat(amounts[i] as string) * 1000000;
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
        setError("Insufficient funds, no UTxOs were found in the depositors wallet");
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
              <TableHead className="w-[120px]">Amount in ADA</TableHead>
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
                Total Deposit:{" "}
                {amounts.reduce((sum, amount) => sum + parseFloat(amount), 0)} ₳
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
  disableAdaAmountInput,
}: {
  index: number;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}) {
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
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            const newAmounts = [...amounts];
            newAmounts.splice(index, 1);
            setAmounts(newAmounts);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
