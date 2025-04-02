import { useState, useEffect, useCallback, useRef } from "react";
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
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Button } from "@/components/ui/button";

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
  const [loaded, setLoaded] = useState<boolean>(false);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [utxos, setUtxos] = useState<UTxO[]>([]);
  const [selectedUtxos, setSelectedUtxos] = useState<UTxO[]>([]);
  const [blockedUtxos, setBlockedUtxos] = useState<
    { hash: string; index: number }[]
  >([]);
  const [manualSelected, setManualSelected] = useState<boolean>(false);
  const { transactions } = usePendingTransactions({
    walletId: appWallet.id,
  });
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const fetchUtxos = useCallback(async () => {
    if (!appWallet) return;
    const address = appWallet.address;
    const blockchainProvider = getProvider(network);

    try {
      const fetchedUtxos: UTxO[] =
        await blockchainProvider.fetchAddressUTxOs(address);
      setUtxos(fetchedUtxos);
      checkPending(fetchedUtxos);
      setLoaded(true);
      setIsInitialLoad(false); // Mark as loaded
    } catch (error) {
      console.error(`Failed to fetch UTxOs for Address ${address}:`, error);
    }
  }, [appWallet, network]);

  useEffect(() => {
    if (!loaded) {
      fetchUtxos().catch((err) => console.error("Error fetching UTxOs:", err));
    }
  }, [fetchUtxos, loaded]);

  const checkPending = (cUtxos: UTxO[]) => {
    if (!transactions || !cUtxos) return;

    const blockedUtxos: { hash: string; index: number }[] =
      transactions.flatMap((m) => {
        const txJson = JSON.parse(m.txJson);
        return txJson.inputs.map(
          (n: { txIn: { txHash: string; txIndex: number } }) => ({
            hash: n.txIn.txHash ?? undefined,
            index: n.txIn.txIndex ?? undefined,
          }),
        );
      });

    const freeUtxos = cUtxos.filter(
      (utxo) =>
        !blockedUtxos.some(
          (bU) =>
            bU.hash === utxo.input.txHash &&
            bU.index === utxo.input.outputIndex,
        ),
    );
    setSelectedUtxos(freeUtxos);
    setBlockedUtxos(blockedUtxos);
  };

  // Track last emitted state to avoid redundant updates
  const lastEmitted = useRef<{ utxos: UTxO[]; manual: boolean }>({
    utxos: [],
    manual: false,
  });

  useEffect(() => {
    if (!isInitialLoad) {
      const isSameAsLast =
        JSON.stringify(lastEmitted.current.utxos) ===
          JSON.stringify(selectedUtxos) &&
        lastEmitted.current.manual === manualSelected;

      if (!isSameAsLast) {
        onSelectionChange([...selectedUtxos], manualSelected);
        lastEmitted.current = {
          utxos: [...selectedUtxos],
          manual: manualSelected,
        };
      }
    }
  }, [selectedUtxos, manualSelected, onSelectionChange, isInitialLoad]);

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

  const handleToggleSelectAll = () => {
    if (selectedUtxos.length > 0) {
      setSelectedUtxos([]);
    } else {
      const freeUtxos = utxos.filter(
        (utxo) =>
          !blockedUtxos.some(
            (bU) =>
              bU.hash === utxo.input.txHash &&
              bU.index === utxo.input.outputIndex,
          ),
      );
      setSelectedUtxos(freeUtxos);
    }
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
              <TableHead>Outputs</TableHead>
              <TableHead style={{ width: '110px', textAlign: 'center' }}>
                <Button
                  onClick={handleToggleSelectAll}
                  className="select-all-btn"
                  style={{
                    width: '110px',
                    minWidth: '110px',
                    maxWidth: '110px',
                    display: 'block',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {selectedUtxos.length > 0 ? "Deselect All" : "Select All"}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {utxos.map((utxo, index) => (
              <TableRow key={index} style={{ height: "50px" }}>
                <TableCell className="truncate">
                  {utxo.input.outputIndex}-{utxo.input.txHash.slice(0, 10)}...
                  {utxo.input.txHash.slice(-10)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <div className="font-weight-400">
                      {Object.values(utxo.output.amount).map(
                        (unit: any, j: number) => {
                          const assetMetadata = walletAssetMetadata[unit.unit];
                          const decimals =
                            unit.unit === "lovelace"
                              ? 6
                              : (assetMetadata?.decimals ?? 0);
                          const assetName =
                            unit.unit === "lovelace"
                              ? "₳"
                              : assetMetadata?.ticker
                                ? `$${assetMetadata?.ticker}`
                                : unit.unit;
                          return (
                            <span key={unit.unit}>
                              {j > 0 && ", "}
                              {unit.quantity / Math.pow(10, decimals)}{" "}
                              {assetName}
                            </span>
                          );
                        },
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell style={{ width: '100px', textAlign: 'center' }}>
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
