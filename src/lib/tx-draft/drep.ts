import { getDRepIds } from "@meshsdk/core-cst";

/** Draft value for the protocol Auto-Abstain DRep; anything else is a DRep id. */
export const AUTO_ABSTAIN_DREP = "Always Abstain";

/** Same bech32 parse the tx builder runs, so "valid" here means it will build. */
export function isValidDrepId(dRepId: string): boolean {
  if (dRepId === AUTO_ABSTAIN_DREP) return true;
  try {
    getDRepIds(dRepId);
    return true;
  } catch {
    return false;
  }
}
