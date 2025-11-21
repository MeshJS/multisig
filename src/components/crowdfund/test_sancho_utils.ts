/**
 * Sancho Network Utilities for Slot Configuration
 * 
 * This module provides a simple resolveSlotNoSancho function that fetches
 * slot configuration from Koios API for Sancho testnet.
 */

import { SlotConfig, unixTimeToEnclosingSlot } from '@meshsdk/common';

// Types for Koios Genesis API response
export type KoiosGenesisResponse = {
  networkmagic: string;
  networkid: string;
  activeslotcoeff: string;
  updatequorum: string;
  maxlovelacesupply: string;
  epochlength: string;
  systemstart: number;
  slotsperkesperiod: string;
  slotlength: string;
  maxkesrevolutions: string;
  securityparam: string;
  alonzogenesis: string;
}[];

// Simple cache for Sancho slot config
let cachedSanchoConfig: SlotConfig | null = null;

/**
 * Fetch Sancho SlotConfig from Koios Genesis API
 * @returns Promise<SlotConfig> or null if fetch fails
 */
async function fetchSanchoSlotConfig(): Promise<SlotConfig | null> {
  try {
    // Check cache first
    if (cachedSanchoConfig) {
      return cachedSanchoConfig;
    }

    // Use configurable API URL or default to Sancho Koios
    const apiUrl = process.env.NEXT_PUBLIC_SANCHO_API_URL || 'https://sancho.koios.rest/api/v1/genesis';
    
    // Add timeout and better error handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data: KoiosGenesisResponse = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const genesis = data[0];
    if (!genesis) {
      return null;
    }
    
    // Convert Koios genesis data to SlotConfig
    const slotConfig: SlotConfig = {
      zeroTime: genesis.systemstart * 1000, // Convert seconds to milliseconds
      zeroSlot: 0, // Koios doesn't provide this, assume 0
      slotLength: parseInt(genesis.slotlength) * 1000, // Convert seconds to milliseconds
      startEpoch: 0, // Koios doesn't provide this, assume 0
      epochLength: parseInt(genesis.epochlength), // Already in seconds
    };

    // Cache the result
    cachedSanchoConfig = slotConfig;
    
    return slotConfig;
  } catch (error) {
    return null;
  }
}

/**
 * Sancho-aware slot number resolver
 * Drop-in replacement for resolveSlotNo that uses Sancho network parameters when available
 * @param network Network name (not used, kept for compatibility)
 * @param milliseconds Timestamp in milliseconds
 * @returns Promise<string> - slot number as string
 */
export async function resolveSlotNoSancho(network: string, milliseconds: number): Promise<string> {
  const sanchoConfig = await fetchSanchoSlotConfig();
  
  if (sanchoConfig) {
    const slot = unixTimeToEnclosingSlot(milliseconds, sanchoConfig);
    return slot.toString();
  }
  
  // Fallback to a reasonable default if fetch fails
  // Use known Sancho network parameters (from previous successful API calls)
  const fallbackConfig: SlotConfig = {
    zeroTime: 1686789000000, // Known Sancho systemstart: 1686789000 (June 15, 2023)
    zeroSlot: 0,
    slotLength: 1000, // 1 second slots (slotlength: "1")
    startEpoch: 0,
    epochLength: 86400, // 1 day epochs (epochlength: "86400")
  };
  
  // Cache the fallback for future use
  cachedSanchoConfig = fallbackConfig;
  
  const slot = unixTimeToEnclosingSlot(milliseconds, fallbackConfig);
  return slot.toString();
}
