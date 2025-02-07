import { useState, useEffect } from "react";
import { Wallet } from "@/types/wallet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Toggle } from "@/components/ui/toggle";
import { UTxO } from "@meshsdk/core";

interface UTxOSelectorProps {
  appWallet: Wallet;
  network: number;
  onSelectionChange: (selectedUtxos: UTxO[], manualSelected: boolean) => void;
}

export default function UTxOSelector({
  appWallet,
  network,
  onSelectionChange,
}: UTxOSelectorProps) {
  const [loaded, setLoaded] = useState<Boolean>(false);
  const [utxos, setUtxos] = useState<UTxO[]>([]);
  const [selectedUtxos, setSelectedUtxos] = useState<UTxO[]>([]);
  const [blockedUtxos, setBlockedUtxos] = useState<
    { hash: string; index: number }[]
  >([]);
  const [manualSelected, setManualSelected] = useState(false);
  const { transactions } = usePendingTransactions({
    walletId: appWallet.id,
  });

  // Fetch UTxOs when wallet or network changes
  useEffect(() => {
    if(!loaded)fetchUtxos();
  }, [appWallet, network]);

  async function fetchUtxos() {
    if (!appWallet) return;
    const address = appWallet.address;
    const blockchainProvider = getProvider(network);
    try {
      const fetchedUtxos: UTxO[] =
        await blockchainProvider.fetchAddressUTxOs(address);
      setUtxos(fetchedUtxos);
      checkPending(fetchedUtxos);
      setLoaded(true)
    } catch (error) {
      console.error(`Failed to fetch UTxOs for Address ${address}:`, error);
    }
  }
  async function checkPending(cUtxos: UTxO[]) {
    if (!transactions || !utxos) return;
    const blockedUtxos: { hash: string; index: number }[] =
      transactions.flatMap((m) => {
        const txJson = JSON.parse(m.txJson);
        return txJson.inputs.map(
          (n: { txIn: { txHash: string; txIndex: number } }) => {
            const hash = n.txIn.txHash ?? undefined;
            const index = n.txIn.txIndex ?? undefined;
            return { hash: hash, index: index };
          },
        );
      });
    console.log(cUtxos);
    const freeUtxos = cUtxos.filter(
        (utxo) =>
          !blockedUtxos.some(
            (bU) => bU.hash === utxo.input.txHash && bU.index === utxo.input.outputIndex
          )
      );
    console.log(freeUtxos);
    setSelectedUtxos(freeUtxos);
    setBlockedUtxos(blockedUtxos);
  }

  useEffect(() => {
    console.log("Emitting Selected UTxOs:", selectedUtxos);
    console.log("Manual Selected:", manualSelected);
    if (selectedUtxos.length > 0 || manualSelected) {
      onSelectionChange([...selectedUtxos], manualSelected);
    }
  }, [selectedUtxos, manualSelected]);

  const handleSelectUtxo = (utxo: UTxO, isChecked: boolean) => {
    setSelectedUtxos((prev) =>
      isChecked
        ? [...prev, utxo]
        : prev.filter(
            (u) =>
              u.input.txHash !== utxo.input.txHash ||
              u.input.outputIndex !== utxo.input.outputIndex,
          ),
    );
  };

  return (
    <div>
      <Toggle
        variant="outline"
        size="sm"
        onClick={() => setManualSelected((prev) => !prev)}
        pressed={manualSelected}
      >
        {manualSelected ? "Hide UTxOs" : "Manual UTxO selection"}
      </Toggle>

      {manualSelected && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tx Index - Hash</TableHead>
              <TableHead>Amount (ADA)</TableHead>
              <TableHead>Select</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {utxos.map((utxo, index) => (
              <TableRow key={index}>
                <TableCell className="truncate">
                  {utxo.input.outputIndex}-{utxo.input.txHash.slice(0, 10)}...
                  {utxo.input.txHash.slice(-10)}
                </TableCell>
                <TableCell>
                  {(
                    utxo.output.amount.reduce(
                      (total, asset) =>
                        asset.unit === "lovelace"
                          ? total + Number(asset.quantity)
                          : total,
                      0,
                    ) / 1_000_000
                  ).toFixed(6)}
                </TableCell>
                <TableCell>
                  {blockedUtxos.some(
                    (bU) =>
                      bU.hash === utxo.input.txHash &&
                      bU.index === utxo.input.outputIndex,
                  ) ? (
                    <span className="font-bold text-red-500">BLOCKED</span>
                  ) : (
                    <Checkbox
                      checked={selectedUtxos.some(
                        (u) =>
                          u.input.txHash === utxo.input.txHash &&
                          u.input.outputIndex === utxo.input.outputIndex,
                      )}
                      onCheckedChange={(checked) =>
                        handleSelectUtxo(utxo, checked as boolean)
                      }
                      disabled={blockedUtxos.some(
                        (bU) =>
                          bU.hash === utxo.input.txHash &&
                          bU.index === utxo.input.outputIndex,
                      )}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
