import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { getProvider } from "@/utils/get-provider";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Toggle } from "@/components/ui/toggle";
import { UTxO } from "@meshsdk/core";
import { cn } from "@/lib/utils";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UTxOSelectorProps {
  appWallet: Wallet;
  network: number;
  onSelectionChange: (selectedUtxos: UTxO[], manualSelected: boolean) => void;
  recipientAmounts?: string[];
  recipientAssets?: string[];
}

export default function UTxOSelector({
  appWallet,
  network,
  onSelectionChange,
  recipientAmounts = [],
  recipientAssets = [],
}: UTxOSelectorProps) {
  const [loaded, setLoaded] = useState<boolean>(false);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [utxos, setUtxos] = useState<UTxO[]>([]);
  const [selectedUtxos, setSelectedUtxos] = useState<UTxO[]>([]);
  const [blockedUtxos, setBlockedUtxos] = useState<
    { hash: string; index: number }[]
  >([]);
  const [manualSelected, setManualSelected] = useState<boolean>(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalUtxos, setTotalUtxos] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Total information state
  const [totalInfo, setTotalInfo] = useState<{
    received_sum: Array<{unit: string, quantity: string}>;
    sent_sum: Array<{unit: string, quantity: string}>;
    tx_count: number;
  } | null>(null);
  const { transactions } = usePendingTransactions({
    walletId: appWallet.id,
  });
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const fetchUtxos = useCallback(async (page: number = currentPage, count: number = pageSize) => {
    if (!appWallet) return;
    const address = appWallet.address;
    const blockchainProvider = getProvider(network);

    try {
      setLoading(true);
      
      // Only fetch two pages at once if page size exceeds 100 (API limit)
      const shouldFetchTwoPages = count > 100;
      const nextPage = page + 1;
      
      // Fetch UTxOs (conditionally two pages)
      const utxoPromises = [
        blockchainProvider.get(`/addresses/${address}/utxos?page=${page}&count=${Math.min(count, 100)}&order=desc`)
      ];
      
      if (shouldFetchTwoPages) {
        // For page sizes > 100, we need to split into two requests of 100 each
        const remainingCount = count - 100;
        utxoPromises.push(
          blockchainProvider.get(`/addresses/${address}/utxos?page=${nextPage}&count=${Math.min(remainingCount, 100)}&order=desc`).catch(() => [])
        );
      }
      
      // Fetch total information in parallel
      const [utxoResponses, totalResponse] = await Promise.all([
        Promise.all(utxoPromises),
        blockchainProvider.get(`/addresses/${address}/total`).catch(() => null)
      ]);
      
      // Process UTxO responses
      let rawUtxos1: any[] = [];
      let rawUtxos2: any[] = [];
      
      if (Array.isArray(utxoResponses[0])) {
        rawUtxos1 = utxoResponses[0];
      } else {
        rawUtxos1 = utxoResponses[0].data || utxoResponses[0] || [];
      }
      
      if (shouldFetchTwoPages && utxoResponses[1]) {
        if (Array.isArray(utxoResponses[1])) {
          rawUtxos2 = utxoResponses[1];
        } else {
          rawUtxos2 = utxoResponses[1].data || utxoResponses[1] || [];
        }
      }
      
      // Combine pages if fetching two
      const allRawUtxos = shouldFetchTwoPages ? [...rawUtxos1, ...rawUtxos2] : rawUtxos1;
      
      // Transform Blockfrost API response to Mesh SDK UTxO format
      const fetchedUtxos: UTxO[] = allRawUtxos.map((rawUtxo: any) => ({
        input: {
          txHash: rawUtxo.tx_hash,
          outputIndex: rawUtxo.output_index,
        },
        output: {
          address: rawUtxo.address,
          amount: rawUtxo.amount, // Keep as array format as expected by the UI
          dataHash: rawUtxo.data_hash,
          inlineDatum: rawUtxo.inline_datum,
          referenceScriptHash: rawUtxo.reference_script_hash,
        },
      }));
      
      setUtxos(fetchedUtxos);
      
      // Set total information if available
      if (totalResponse) {
        setTotalInfo(totalResponse);
      }
      
      // Calculate pagination based on whether we fetched two pages
      if (shouldFetchTwoPages) {
        // Two-page logic: when count > 100, we split into two API requests
        const displayPage = Math.floor((page - 1) / 2) + 1;
        const firstPageCount = Math.min(count, 100);
        const secondPageCount = Math.min(count - 100, 100);
        
        if (rawUtxos1.length < firstPageCount) {
          // First page is incomplete, so we're at the end
          setTotalUtxos((displayPage - 1) * count + rawUtxos1.length);
          setTotalPages(displayPage);
        } else if (rawUtxos2.length < secondPageCount) {
          // Second page is incomplete, so we're at the end
          setTotalUtxos((displayPage - 1) * count + rawUtxos1.length + rawUtxos2.length);
          setTotalPages(displayPage);
        } else {
          // Both pages are full, so there might be more
          setTotalUtxos(displayPage * count);
          setTotalPages(displayPage + 1);
        }
      } else {
        // Single-page logic: when count <= 100, we use single API request
        if (rawUtxos1.length < count) {
          setTotalUtxos((page - 1) * count + rawUtxos1.length);
          setTotalPages(page);
        } else {
          setTotalUtxos(page * count);
          setTotalPages(page + 1);
        }
      }
      
      checkPending(fetchedUtxos);
      setLoaded(true);
      setIsInitialLoad(false);
    } catch (error) {
      console.error(`Failed to fetch UTxOs for Address ${address}:`, error);
    } finally {
      setLoading(false);
    }
  }, [appWallet, network, currentPage, pageSize]);

  useEffect(() => {
    if (!loaded) {
      fetchUtxos().catch((err) => console.error("Error fetching UTxOs:", err));
    }
  }, [fetchUtxos, loaded]);

  // Reset pagination when wallet changes
  useEffect(() => {
    setCurrentPage(1);
    setTotalPages(1);
    setTotalUtxos(0);
    setLoaded(false);
  }, [appWallet?.id]);

  // Memoize blocked UTxOs computation
  const computedBlockedUtxos = useMemo(() => {
    if (!transactions) return [];
    return transactions.flatMap((m) => {
      const txJson = JSON.parse(m.txJson);
      return txJson.inputs.map(
        (n: { txIn: { txHash: string; txIndex: number } }) => ({
          hash: n.txIn.txHash ?? undefined,
          index: n.txIn.txIndex ?? undefined,
        }),
      );
    });
  }, [transactions]);

  const checkPending = useCallback((cUtxos: UTxO[]) => {
    if (!cUtxos) return;

    const freeUtxos = cUtxos.filter(
      (utxo) =>
        !computedBlockedUtxos.some(
          (bU) =>
            bU.hash === utxo.input.txHash &&
            bU.index === utxo.input.outputIndex,
        ),
    );
    setSelectedUtxos(freeUtxos);
    setBlockedUtxos(computedBlockedUtxos);
  }, [computedBlockedUtxos]);

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

  const handleSelectUtxo = useCallback((utxo: UTxO, isChecked: boolean) => {
    setSelectedUtxos((prev) =>
      isChecked
        ? [...prev, utxo]
        : prev.filter(
            (u) =>
              u.input.txHash !== utxo.input.txHash ||
              u.input.outputIndex !== utxo.input.outputIndex,
          ),
    );
  }, []);

  const handleRowClick = useCallback((utxo: UTxO) => {
    const isCurrentlySelected = selectedUtxos.some(
      (u) =>
        u.input.txHash === utxo.input.txHash &&
        u.input.outputIndex === utxo.input.outputIndex,
    );
    
    const isBlocked = blockedUtxos.some(
      (bU) =>
        bU.hash === utxo.input.txHash &&
        bU.index === utxo.input.outputIndex,
    );

    if (!isBlocked) {
      handleSelectUtxo(utxo, !isCurrentlySelected);
    }
  }, [selectedUtxos, blockedUtxos, handleSelectUtxo]);

  const handleToggleSelectAll = useCallback(() => {
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
  }, [selectedUtxos.length, utxos, blockedUtxos]);

  // Pagination handlers - memoized
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== currentPage) {
      setCurrentPage(newPage);
      
      // Adjust page number based on whether we're fetching two pages at once
      if (pageSize > 100) {
        // For display page 1, we fetch API pages 1&2
        // For display page 2, we fetch API pages 3&4, etc.
        const apiPage = (newPage - 1) * 2 + 1;
        fetchUtxos(apiPage, pageSize);
      } else {
        // Single page fetching
        fetchUtxos(newPage, pageSize);
      }
    }
  }, [totalPages, currentPage, pageSize, fetchUtxos]);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    fetchUtxos(1, newPageSize);
  }, [fetchUtxos]);

  const handlePreviousPage = useCallback(() => {
    handlePageChange(currentPage - 1);
  }, [handlePageChange, currentPage]);

  const handleNextPage = useCallback(() => {
    handlePageChange(currentPage + 1);
  }, [handlePageChange, currentPage]);

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
        <div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tx Index - Hash</TableHead>
              <TableHead>Outputs</TableHead>
              <TableHead style={{ width: '110px', textAlign: 'center' }}>
                <Button
                  onClick={handleToggleSelectAll}
                  variant={selectedUtxos.length > 0 ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "w-full transition-all duration-200",
                    {
                      "bg-blue-600 hover:bg-blue-700 text-white": selectedUtxos.length > 0,
                      "border-blue-300 text-blue-600 hover:bg-blue-50": selectedUtxos.length === 0,
                    }
                  )}
                >
                  {selectedUtxos.length > 0 ? "Deselect All" : "Select All"}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {utxos.map((utxo, index) => {
              const isSelected = selectedUtxos.some(
                (u) =>
                  u.input.txHash === utxo.input.txHash &&
                  u.input.outputIndex === utxo.input.outputIndex,
              );
              
              const isBlocked = blockedUtxos.some(
                (bU) =>
                  bU.hash === utxo.input.txHash &&
                  bU.index === utxo.input.outputIndex,
              );

              return (
                <TableRow 
                  key={index} 
                  style={{ 
                    height: "50px",
                    borderLeft: isSelected ? "4px solid rgb(59 130 246)" : undefined,
                  }}
                  className={cn(
                    "transition-all duration-200 ease-in-out",
                    {
                      // Selected state
                      "bg-blue-50 dark:bg-blue-950/20 shadow-md": isSelected,
                      // Unselected state
                      "bg-white dark:bg-gray-900": !isSelected,
                      // Interactive states
                      "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50": !isBlocked && !isSelected,
                      "cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30": !isBlocked && isSelected,
                      // Blocked state
                      "cursor-not-allowed opacity-60": isBlocked,
                    }
                  )}
                  onClick={() => handleRowClick(utxo)}
                >
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
                    {isBlocked ? (
                      <span className="font-bold text-red-500 text-xs">BLOCKED</span>
                    ) : (
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            handleSelectUtxo(utxo, checked as boolean)
                          }
                          disabled={isBlocked}
                          onClick={(e) => e.stopPropagation()}
                          className="h-5 w-5 transition-all duration-200"
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        
        {/* Pagination Controls */}
        {manualSelected && utxos.length > 0 && (
          <div className="flex items-center justify-end mt-4 px-2">
            <div className="flex items-center space-x-2">
              {/* Page Size Selector */}
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700">
                  Show:
                </label>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => handlePageSizeChange(Number(value))}
                  disabled={loading}
                >
                  <SelectTrigger className="w-20 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Pagination Buttons */}
              <div className="flex items-center space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1 || loading}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                {/* Page Numbers */}
                <div className="flex items-center space-x-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => handlePageChange(pageNum)}
                        disabled={loading}
                        className="h-8 w-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages || loading}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-center items-center py-4">
            <div className="text-sm text-gray-500">Loading UTxOs...</div>
          </div>
        )}
        
        {/* Total Information Display */}
        {totalInfo && (
          <div className="mt-4 p-3 bg-muted/30 border rounded-lg">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-medium">Address Summary</h4>
                <p className="text-xs text-muted-foreground">
                  Total transactions: <span className="font-medium">{totalInfo.tx_count}</span>
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-6">
                <div className="flex flex-col gap-1">
                  <h5 className="text-xs font-medium text-green-600">Received</h5>
                  <div className="text-xs text-muted-foreground">
                    {totalInfo.received_sum.map((asset, index) => {
                      const assetMetadata = walletAssetMetadata[asset.unit];
                      const decimals = asset.unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
                      const assetName = asset.unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${assetMetadata.ticker}` : asset.unit;
                      return (
                        <div key={index}>
                          {(parseFloat(asset.quantity) / Math.pow(10, decimals)).toFixed(6)} {assetName}
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <div className="flex flex-col gap-1">
                  <h5 className="text-xs font-medium text-red-600">Sent</h5>
                  <div className="text-xs text-muted-foreground">
                    {totalInfo.sent_sum.map((asset, index) => {
                      const assetMetadata = walletAssetMetadata[asset.unit];
                      const decimals = asset.unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
                      const assetName = asset.unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${assetMetadata.ticker}` : asset.unit;
                      return (
                        <div key={index}>
                          {(parseFloat(asset.quantity) / Math.pow(10, decimals)).toFixed(6)} {assetName}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Funds Summary */}
        <FundsSummary 
          selectedUtxos={selectedUtxos}
          recipientAmounts={recipientAmounts}
          recipientAssets={recipientAssets}
          walletAssetMetadata={walletAssetMetadata}
        />
        </div>
      )}
    </div>
  );
}

// Funds Summary Component
function FundsSummary({
  selectedUtxos,
  recipientAmounts,
  recipientAssets,
  walletAssetMetadata,
}: {
  selectedUtxos: UTxO[];
  recipientAmounts: string[];
  recipientAssets: string[];
  walletAssetMetadata: { [key: string]: { assetName: string; decimals: number; ticker?: string } };
}) {
  // Calculate available funds from selected UTxOs
  const availableFunds = selectedUtxos.reduce((acc, utxo) => {
    utxo.output.amount.forEach((asset) => {
      const unit = asset.unit;
      const quantity = asset.quantity;
      
      if (!acc[unit]) {
        acc[unit] = 0;
      }
      acc[unit] += parseFloat(quantity);
    });
    return acc;
  }, {} as { [unit: string]: number });

  // Calculate required funds from recipients
  const requiredFunds = recipientAmounts.reduce((acc, amount, index) => {
    const asset = recipientAssets[index];
    if (!asset || !amount || parseFloat(amount) <= 0) return acc;
    
    const unit = asset === "ADA" ? "lovelace" : asset;
    const assetMetadata = walletAssetMetadata[unit];
    const multiplier = unit === "lovelace" ? 1000000 : Math.pow(10, assetMetadata?.decimals ?? 0);
    const requiredAmount = parseFloat(amount) * multiplier;
    
    if (!acc[unit]) {
      acc[unit] = 0;
    }
    acc[unit] += requiredAmount;
    return acc;
  }, {} as { [unit: string]: number });

  // Get all unique units
  const allUnits = new Set([...Object.keys(availableFunds), ...Object.keys(requiredFunds)]);
  
  if (allUnits.size === 0) return null;

  return (
    <div className="mt-4 p-3 sm:p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2 sm:mb-3">Transaction Summary</h4>
      <p className="text-xs text-blue-700 dark:text-blue-300 mb-3 leading-relaxed">
        Funds available through selected UTxOs vs. amounts required by recipients
      </p>
      
      <div className="space-y-2 sm:space-y-3">
        {Array.from(allUnits).map((unit) => {
          const available = availableFunds[unit] || 0;
          const required = requiredFunds[unit] || 0;
          const assetMetadata = walletAssetMetadata[unit];
          const decimals = unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
          const assetName = unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${assetMetadata.ticker}` : assetMetadata?.assetName || unit;
          
          const availableFormatted = (available / Math.pow(10, decimals)).toFixed(6);
          const requiredFormatted = (required / Math.pow(10, decimals)).toFixed(6);
          const difference = available - required;
          const differenceFormatted = (difference / Math.pow(10, decimals)).toFixed(6);
          
          const isSufficient = difference >= 0;
          const isDeficit = difference < 0;
          
          return (
            <div key={unit} className="p-3 bg-white dark:bg-gray-800 rounded border">
              {/* Asset Header */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium">{assetName}</span>
                <span className="text-xs text-gray-500 font-mono truncate">{unit}</span>
              </div>
              
              {/* Mobile Layout */}
              <div className="block sm:hidden space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-600 dark:text-gray-400">From Selected UTxOs</span>
                  <span className="font-medium text-sm">{availableFormatted}</span>
                </div>
                
                {required > 0 && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-600 dark:text-gray-400">Required by Recipients</span>
                      <span className="font-medium text-sm text-red-600 dark:text-red-400">{requiredFormatted}</span>
                    </div>
                    
                    <div className="flex justify-between items-center pt-1 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-xs text-gray-600 dark:text-gray-400">Remaining/Change</span>
                      <span className={`font-medium text-sm ${
                        isSufficient 
                          ? "text-green-600 dark:text-green-400" 
                          : "text-red-600 dark:text-red-400"
                      }`}>
                        {differenceFormatted}
                      </span>
                    </div>
                  </>
                )}
              </div>
              
              {/* Desktop Layout */}
              <div className="hidden sm:flex items-center justify-between">
                <div className="text-right">
                  <div className="text-xs text-gray-600 dark:text-gray-400">From Selected UTxOs</div>
                  <div className="font-medium text-sm">{availableFormatted}</div>
                </div>
                
                {required > 0 && (
                  <>
                    <div className="text-gray-400 text-sm">-</div>
                    <div className="text-right">
                      <div className="text-xs text-gray-600 dark:text-gray-400">Required by Recipients</div>
                      <div className="font-medium text-sm text-red-600 dark:text-red-400">{requiredFormatted}</div>
                    </div>
                    
                    <div className="text-gray-400 text-sm">=</div>
                    <div className="text-right">
                      <div className="text-xs text-gray-600 dark:text-gray-400">Remaining/Change</div>
                      <div className={`font-medium text-sm ${
                        isSufficient 
                          ? "text-green-600 dark:text-green-400" 
                          : "text-red-600 dark:text-red-400"
                      }`}>
                        {differenceFormatted}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {Object.keys(requiredFunds).length === 0 && (
        <div className="text-center py-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          No recipient amounts specified - showing only available funds from selected UTxOs
        </div>
      )}
    </div>
  );
}