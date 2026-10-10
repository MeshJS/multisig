import { useMemo } from "react";

import type { AddressLabeler } from "@/types/token-flow";
import type { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";

/**
 * Shared address labeling: resolves an address to "Self (Multisig)", a
 * signer's description, or a contact name. Same logic as the inline
 * implementations in transaction-card.tsx and new-transaction/index.tsx
 * (kept in sync until those migrate here).
 */
export default function useAddressLabels(appWallet?: Wallet): {
  labelAddress: AddressLabeler;
} {
  const { data: contacts } = api.contact.getAll.useQuery(
    { walletId: appWallet?.id ?? "" },
    { enabled: !!appWallet?.id },
  );

  const contactMap = useMemo(() => {
    const map = new Map<string, string>();
    contacts?.forEach((contact: { address: string; name: string }) => {
      map.set(contact.address, contact.name);
    });
    return map;
  }, [contacts]);

  const labelAddress = useMemo<AddressLabeler>(() => {
    return (address: string) => {
      if (!appWallet) return { label: "", type: "unknown" };

      if (address === appWallet.address) {
        return { label: "Self (Multisig)", type: "self" };
      }

      const signerIndex = appWallet.signersAddresses?.findIndex(
        (addr) => addr === address,
      );
      if (signerIndex !== undefined && signerIndex >= 0) {
        const signerDescription =
          appWallet.signersDescriptions?.[signerIndex] ||
          `Signer ${signerIndex + 1}`;
        return { label: signerDescription, type: "signer" };
      }

      const contactName = contactMap.get(address);
      if (contactName) {
        return { label: contactName, type: "contact" };
      }

      return { label: "", type: "unknown" };
    };
  }, [appWallet, contactMap]);

  return { labelAddress };
}
