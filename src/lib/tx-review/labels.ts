import type { PrismaClient } from "@prisma/client";

import type { AddressLabeler } from "@/types/token-flow";

/**
 * Server-side address labelling for the review card.
 *
 * Same resolution order as `src/hooks/useAddressLabels.ts` (which cannot run
 * here — it is a React hook over tRPC queries): the wallet itself, then a
 * named signer, then a saved contact, else unknown. The label is what the
 * human reads next to an amount, so it must come from data the wallet's own
 * signers control, never from the transaction being reviewed.
 */
export function createServerAddressLabeler(args: {
  walletAddress: string;
  signersAddresses: string[];
  signersDescriptions: string[];
  contacts: { address: string; name: string }[];
}): AddressLabeler {
  const contactNames = new Map(
    args.contacts.map((contact) => [contact.address, contact.name]),
  );
  return (address: string) => {
    if (address && address === args.walletAddress) {
      return { label: "This wallet", type: "self" };
    }
    const signerIndex = args.signersAddresses.indexOf(address);
    if (signerIndex >= 0) {
      return {
        label:
          args.signersDescriptions[signerIndex]?.trim() ||
          `Signer ${signerIndex + 1}`,
        type: "signer",
      };
    }
    const contact = contactNames.get(address);
    if (contact) return { label: contact, type: "contact" };
    return { label: "", type: "unknown" };
  };
}

export async function loadContacts(
  db: PrismaClient,
  walletId: string,
): Promise<{ address: string; name: string }[]> {
  try {
    return await db.contact.findMany({
      where: { walletId },
      select: { address: true, name: true },
    });
  } catch {
    // Labels are a courtesy; a contacts lookup failure must not block a review.
    return [];
  }
}
