export type DrepStatus = {
  /** Registered as a DRep on chain right now (a registration not since retired). */
  active: boolean;
};

/** The raw REST accessor (`BlockfrostProvider.get`), not the typed wrappers. */
type DrepProvider = {
  get: (url: string) => Promise<unknown>;
};

type BlockfrostDrep = {
  active?: boolean;
};

/**
 * Whether the wallet's DRep credential is registered on chain.
 *
 * Reads Blockfrost's `/governance/dreps/{id}` directly and trusts only its
 * `active` flag — the same check the app makes before it lets a wallet vote
 * (`vote-card.tsx`, `wallet-data-loader-wrapper.tsx`) and what
 * `api/v1/drepInfo.ts` reports. A vote cast by an unregistered DRep builds
 * fine and is rejected by the node only at submit, after every signature is
 * in, so the state must be known before the draft is validated.
 *
 * Blockfrost answers 404 for a DRep that has never registered, which means
 * "not active" rather than a failure. Anything else is rethrown: a caller
 * deciding whether a vote is allowed must not guess when the lookup itself
 * failed.
 */
export async function fetchDrepStatus(
  provider: DrepProvider,
  dRepId: string,
): Promise<DrepStatus> {
  try {
    const data = (await provider.get(`/governance/dreps/${dRepId.trim()}`)) as
      | BlockfrostDrep
      | null
      | undefined;
    return { active: data?.active === true };
  } catch (error) {
    if (isNotFound(error)) return { active: false };
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    (error as { status?: number })?.status === 404 ||
    (error instanceof Error && error.message.includes("404"))
  );
}
