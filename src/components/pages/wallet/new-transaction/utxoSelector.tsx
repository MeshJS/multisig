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
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search, Loader2, Info, AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { truncateTokenSymbol } from "@/utils/strings";

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
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalUtxos, setTotalUtxos] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState<boolean>(false);
  
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
      
      // Fetch UTxOs
      const utxoResponses = await Promise.all(utxoPromises);
      
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

  // Filter UTxOs based on search query
  const filteredUtxos = useMemo(() => {
    if (!searchQuery.trim()) return utxos;
    
    const query = searchQuery.toLowerCase();
    return utxos.filter((utxo) => {
      const txHash = utxo.input.txHash.toLowerCase();
      const outputIndex = utxo.input.outputIndex.toString();
      return txHash.includes(query) || outputIndex.includes(query);
    });
  }, [utxos, searchQuery]);

  // Calculate total value of selected UTxOs
  const selectedTotalValue = useMemo(() => {
    return selectedUtxos.reduce((acc, utxo) => {
      if (Array.isArray(utxo.output.amount)) {
        utxo.output.amount.forEach((asset: any) => {
          const unit = asset.unit;
          const quantity = parseFloat(asset.quantity);
          if (!acc[unit]) {
            acc[unit] = 0;
          }
          acc[unit] += quantity;
        });
      }
      return acc;
    }, {} as { [unit: string]: number });
  }, [selectedUtxos]);

  // Count available vs blocked UTxOs
  const availableCount = utxos.length - blockedUtxos.length;
  const selectedCount = selectedUtxos.length;

  // Calculate if there are any deficits (for header indicator)
  const hasDeficit = useMemo(() => {
    if (recipientAmounts.length === 0) return false;
    
    // Calculate available funds from selected UTxOs
    const availableFunds = selectedUtxos.reduce((acc, utxo) => {
      if (Array.isArray(utxo.output.amount)) {
        utxo.output.amount.forEach((asset: any) => {
          const unit = asset.unit;
          const quantity = parseFloat(asset.quantity);
          if (!acc[unit]) {
            acc[unit] = 0;
          }
          acc[unit] += quantity;
        });
      }
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

    // Check if any required amount exceeds available
    return Object.keys(requiredFunds).some((unit) => {
      const available = availableFunds[unit] || 0;
      const required = requiredFunds[unit] || 0;
      return available < required;
    });
  }, [selectedUtxos, recipientAmounts, recipientAssets, walletAssetMetadata]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <Toggle
          variant="outline"
          size="sm"
          onClick={() => setManualSelected((prev) => !prev)}
          pressed={manualSelected}
          className="shrink-0 self-start"
        >
          {manualSelected ? "Hide Multisig UTxOs" : "Select Multisig UTxOs"}
        </Toggle>
        
        {manualSelected && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedCount}</span>
            <span>of</span>
            <span className="font-medium text-foreground">{availableCount}</span>
            <span>selected</span>
            {blockedUtxos.length > 0 && (
              <>
                <span>•</span>
                <span className="text-red-600 dark:text-red-400">{blockedUtxos.length} blocked</span>
              </>
            )}
          </div>
        )}
      </div>

      {manualSelected && (
        <div className="space-y-4">
          {/* Selection Summary - Expandable */}
          {selectedCount > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                className="w-full p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  {hasDeficit && (
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span className={cn("text-sm font-semibold", hasDeficit && "text-red-600 dark:text-red-400")}>
                    {selectedCount} UTxO{selectedCount !== 1 ? 's' : ''} Selected
                  </span>
                  {hasDeficit && (
                    <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                      (Insufficient)
                    </span>
                  )}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">These UTxOs will be used as inputs for your transaction</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                    {Object.entries(selectedTotalValue).map(([unit, quantity]) => {
                      const assetMetadata = walletAssetMetadata[unit];
                      const decimals = unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
                      const assetName = unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${truncateTokenSymbol(assetMetadata.ticker)}` : truncateTokenSymbol(unit);
                      const formatted = (quantity / Math.pow(10, decimals)).toFixed(6);
                      return (
                        <span key={unit} className="font-medium">
                          {formatted} {assetName}
                        </span>
                      );
                    })}
                  </div>
                  {isSummaryExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </div>
              </button>
              
              {/* Expanded Content */}
              {isSummaryExpanded && (
                <div className="px-3 pb-3 pt-0 border-t">
                  <FundsSummaryContent
                    selectedUtxos={selectedUtxos}
                    recipientAmounts={recipientAmounts}
                    recipientAssets={recipientAssets}
                    walletAssetMetadata={walletAssetMetadata}
                  />
                </div>
              )}
            </div>
          )}

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by hash or index..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>

          {/* Table */}
          {loading && utxos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border rounded-lg bg-muted/20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading UTxOs...</p>
            </div>
          ) : filteredUtxos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border rounded-lg bg-muted/20">
              <p className="text-sm text-muted-foreground mb-1">
                {searchQuery ? "No UTxOs match your search" : "No UTxOs available"}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  className="mt-2"
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile Card Layout */}
              <div className="block sm:hidden space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <Button
                    onClick={handleToggleSelectAll}
                    variant={selectedUtxos.length > 0 ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-7 px-3 text-xs transition-all duration-200",
                      {
                        "bg-blue-600 hover:bg-blue-700 text-white": selectedUtxos.length > 0,
                        "border-blue-300 text-blue-600 hover:bg-blue-50": selectedUtxos.length === 0,
                      }
                    )}
                  >
                    {selectedUtxos.length > 0 ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                {filteredUtxos.map((utxo, index) => {
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
                    <div
                      key={`${utxo.input.txHash}-${utxo.input.outputIndex}`}
                      className={cn(
                        "p-3 border rounded-lg transition-all duration-200",
                        {
                          "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800": isSelected,
                          "bg-background border-border": !isSelected,
                          "opacity-60 cursor-not-allowed": isBlocked,
                          "cursor-pointer hover:bg-muted/50": !isBlocked,
                        }
                      )}
                      onClick={() => !isBlocked && handleRowClick(utxo)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {isSelected && (
                              <div className="w-1 h-4 bg-blue-600 rounded-full shrink-0" />
                            )}
                            <div className="font-mono text-xs break-all">
                              <span className="font-medium">{utxo.input.outputIndex}</span>
                              <span className="text-muted-foreground">-</span>
                              <span className="text-muted-foreground break-all">
                                {utxo.input.txHash.slice(0, 8)}...{utxo.input.txHash.slice(-8)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {Array.isArray(utxo.output.amount) ? (
                              utxo.output.amount.map((unit: any, j: number) => {
                                const assetMetadata = walletAssetMetadata[unit.unit];
                                const decimals =
                                  unit.unit === "lovelace"
                                    ? 6
                                    : (assetMetadata?.decimals ?? 0);
                                const assetName =
                                  unit.unit === "lovelace"
                                    ? "₳"
                                    : assetMetadata?.ticker
                                      ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                      : truncateTokenSymbol(unit.unit);
                                return (
                                  <span key={unit.unit} className="text-xs font-medium">
                                    {j > 0 && <span className="text-muted-foreground">,</span>}
                                    <span>{(parseFloat(unit.quantity) / Math.pow(10, decimals)).toFixed(6)}</span>
                                    <span className="ml-1">{assetName}</span>
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-xs text-muted-foreground">No amount data</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {isBlocked ? (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                              BLOCKED
                            </span>
                          ) : (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                handleSelectUtxo(utxo, checked as boolean)
                              }
                              disabled={isBlocked}
                              onClick={(e) => e.stopPropagation()}
                              className="h-5 w-5 transition-all duration-200"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden sm:block border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Tx Index - Hash</TableHead>
                      <TableHead className="font-semibold">Outputs</TableHead>
                      <TableHead className="font-semibold text-center w-[120px]">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            onClick={handleToggleSelectAll}
                            variant={selectedUtxos.length > 0 ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "h-7 px-3 text-xs transition-all duration-200",
                              {
                                "bg-blue-600 hover:bg-blue-700 text-white": selectedUtxos.length > 0,
                                "border-blue-300 text-blue-600 hover:bg-blue-50": selectedUtxos.length === 0,
                              }
                            )}
                          >
                            {selectedUtxos.length > 0 ? "Deselect All" : "Select All"}
                          </Button>
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {filteredUtxos.map((utxo, index) => {
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
                        key={`${utxo.input.txHash}-${utxo.input.outputIndex}`}
                        className={cn(
                          "transition-all duration-200 ease-in-out",
                          {
                            // Selected state
                            "bg-blue-50 dark:bg-blue-950/20": isSelected,
                            // Interactive states
                            "cursor-pointer hover:bg-muted/50": !isBlocked,
                            // Blocked state
                            "cursor-not-allowed opacity-60": isBlocked,
                          }
                        )}
                        onClick={() => handleRowClick(utxo)}
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            {isSelected && (
                              <div className="w-1 h-6 bg-blue-600 rounded-full shrink-0" />
                            )}
                            <div className="font-mono text-xs">
                              <span className="font-medium">{utxo.input.outputIndex}</span>
                              <span className="text-muted-foreground">-</span>
                              <span className="text-muted-foreground">
                                {utxo.input.txHash.slice(0, 10)}...{utxo.input.txHash.slice(-10)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {Array.isArray(utxo.output.amount) ? (
                              utxo.output.amount.map((unit: any, j: number) => {
                                const assetMetadata = walletAssetMetadata[unit.unit];
                                const decimals =
                                  unit.unit === "lovelace"
                                    ? 6
                                    : (assetMetadata?.decimals ?? 0);
                                const assetName =
                                  unit.unit === "lovelace"
                                    ? "₳"
                                    : assetMetadata?.ticker
                                      ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                      : truncateTokenSymbol(unit.unit);
                                return (
                                  <span key={unit.unit} className="text-sm font-medium">
                                    {j > 0 && <span className="text-muted-foreground">,</span>}
                                    <span>{(parseFloat(unit.quantity) / Math.pow(10, decimals)).toFixed(6)}</span>
                                    <span className="ml-1">{assetName}</span>
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-sm text-muted-foreground">No amount data</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-center">
                          {isBlocked ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                    BLOCKED
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">This UTxO is used in a pending transaction</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
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
              </div>
            </>
          )}
        
        {/* Pagination Controls */}
        {manualSelected && filteredUtxos.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Showing</span>
              <span className="font-medium text-foreground">
                {Math.min((currentPage - 1) * pageSize + 1, filteredUtxos.length)}
              </span>
              <span>-</span>
              <span className="font-medium text-foreground">
                {Math.min(currentPage * pageSize, filteredUtxos.length)}
              </span>
              <span>of</span>
              <span className="font-medium text-foreground">{filteredUtxos.length}</span>
              {searchQuery && (
                <>
                  <span>•</span>
                  <span className="text-xs">filtered</span>
                </>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {/* Page Size Selector */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">
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
              <div className="flex items-center gap-1">
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
                <div className="flex items-center gap-1">
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
                        className="h-8 w-8 p-0 text-xs"
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
        {loading && utxos.length > 0 && (
          <div className="flex justify-center items-center py-4 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading more UTxOs...</span>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}

// Funds Summary Content Component (for expandable section)
function FundsSummaryContent({
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

  // Check if there are any deficits
  const hasDeficit = Array.from(allUnits).some((unit) => {
    const available = availableFunds[unit] || 0;
    const required = requiredFunds[unit] || 0;
    return available < required;
  });

  // Get deficit details for alert message
  const deficitDetails = Array.from(allUnits)
    .filter((unit) => {
      const available = availableFunds[unit] || 0;
      const required = requiredFunds[unit] || 0;
      return available < required;
    })
    .map((unit) => {
      const available = availableFunds[unit] || 0;
      const required = requiredFunds[unit] || 0;
      const assetMetadata = walletAssetMetadata[unit];
      const decimals = unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
      const assetName = unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${truncateTokenSymbol(assetMetadata.ticker)}` : assetMetadata?.assetName || truncateTokenSymbol(unit);
      const shortfall = (required - available) / Math.pow(10, decimals);
      return `${assetName} (${shortfall.toFixed(6)} short)`;
    });

  return (
    <div className="mt-3">
      {hasDeficit && (
        <Alert variant="destructive" className="mb-3">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">Insufficient funds:</span> Selected UTxOs do not have enough funds to cover recipient requirements. {deficitDetails.join(", ")}
          </AlertDescription>
        </Alert>
      )}
      
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        Funds available through selected UTxOs vs. amounts required by recipients
      </p>
      
      <div className="space-y-2 sm:space-y-3">
        {Array.from(allUnits).map((unit) => {
          const available = availableFunds[unit] || 0;
          const required = requiredFunds[unit] || 0;
          const assetMetadata = walletAssetMetadata[unit];
          const decimals = unit === "lovelace" ? 6 : (assetMetadata?.decimals ?? 0);
          const assetName = unit === "lovelace" ? "₳" : assetMetadata?.ticker ? `$${truncateTokenSymbol(assetMetadata.ticker)}` : assetMetadata?.assetName || truncateTokenSymbol(unit);
          
          const availableFormatted = (available / Math.pow(10, decimals)).toFixed(6);
          const requiredFormatted = (required / Math.pow(10, decimals)).toFixed(6);
          const difference = available - required;
          const differenceFormatted = (difference / Math.pow(10, decimals)).toFixed(6);
          
          const isSufficient = difference >= 0;
          const isDeficit = difference < 0;
          
          return (
            <div 
              key={unit} 
              className={cn(
                "p-3 bg-white dark:bg-gray-800 rounded border",
                isDeficit && "border-red-500 dark:border-red-500 bg-red-50 dark:bg-red-950/20"
              )}
            >
              {/* Asset Header */}
              <div className="flex items-center gap-2 mb-3">
                {isDeficit && (
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                )}
                <span className={cn("text-sm font-medium", isDeficit && "text-red-600 dark:text-red-400")}>
                  {assetName}
                </span>
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