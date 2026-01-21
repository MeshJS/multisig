import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Hook to detect when Cardano wallets are injected into window.cardano
 * Polls window.cardano periodically and triggers callbacks when wallets appear
 */
export function useWalletDetection(options?: {
  onWalletsDetected?: (walletCount: number) => void;
  pollingInterval?: number;
  maxPollingTime?: number;
}) {
  const {
    onWalletsDetected,
    pollingInterval = 100,
    maxPollingTime = 10000, // 10 seconds max polling
  } = options || {};

  const [detectedWalletCount, setDetectedWalletCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const hasDetectedWalletsRef = useRef(false);
  const hasCalledCallbackRef = useRef(false);
  const pollCountRef = useRef(0);

  const checkWallets = useCallback(() => {
    if (typeof window === "undefined") return 0;

    // If we've already detected wallets and called the callback, stop checking
    if (hasDetectedWalletsRef.current) {
      return detectedWalletCount;
    }

    const cardano = (window as any).cardano || {};
    const walletKeys = Object.keys(cardano);
    const walletCount = walletKeys.length;

    pollCountRef.current++;

    if (walletCount > 0 && !hasDetectedWalletsRef.current) {
      hasDetectedWalletsRef.current = true;
      setDetectedWalletCount(walletCount);
      setIsPolling(false);
      
      // Clear polling interval BEFORE calling callback
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      // Call callback only once
      if (!hasCalledCallbackRef.current && onWalletsDetected) {
        hasCalledCallbackRef.current = true;
        onWalletsDetected(walletCount);
      }
      return walletCount;
    }

    // Check if we've exceeded max polling time
    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed >= maxPollingTime) {
      setIsPolling(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return walletCount;
    }

    return walletCount;
  }, [onWalletsDetected, maxPollingTime, detectedWalletCount]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    // Check immediately
    const initialCount = checkWallets();
    if (initialCount > 0) {
      return; // Already detected, no need to poll
    }

    setIsPolling(true);
    startTimeRef.current = Date.now();
    pollCountRef.current = 0;

    // Start polling
    intervalRef.current = setInterval(() => {
      checkWallets();
    }, pollingInterval);
  }, [checkWallets, pollingInterval]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    hasDetectedWalletsRef.current = false;
    setDetectedWalletCount(0);
    startTimeRef.current = Date.now();
    pollCountRef.current = 0;
  }, [stopPolling]);

  // Auto-start polling on mount if no wallets detected
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if wallets are already available
    const cardano = (window as any).cardano || {};
    const initialCount = Object.keys(cardano).length;

    if (initialCount > 0 && !hasCalledCallbackRef.current) {
      hasDetectedWalletsRef.current = true;
      setDetectedWalletCount(initialCount);
      setIsPolling(false);
      
      // Call callback if wallets are already present
      if (onWalletsDetected && !hasCalledCallbackRef.current) {
        hasCalledCallbackRef.current = true;
        onWalletsDetected(initialCount);
      }
      return;
    }

    // Start polling if no wallets detected
    if (initialCount === 0) {
      startPolling();
    }

    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling, onWalletsDetected]);

  return {
    detectedWalletCount,
    isPolling,
    startPolling,
    stopPolling,
    reset,
    checkWallets: () => {
      const count = checkWallets();
      setDetectedWalletCount(count);
      return count;
    },
  };
}

