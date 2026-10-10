export type StakeAccountStatus = {
  /** Registered on chain right now (a registration not since undone). */
  active: boolean;
  poolId: string | null;
};

/** The raw REST accessor (`BlockfrostProvider.get`), not the typed wrappers. */
type AccountProvider = {
  get: (url: string) => Promise<unknown>;
};

type BlockfrostAccount = {
  active?: boolean;
  active_epoch?: number | null;
  pool_id?: string | null;
};

/**
 * Whether the reward address is registered on chain, and where it delegates.
 *
 * Reads Blockfrost's `/accounts/{stake}` directly and trusts only its
 * `active` flag — the same check the builder canvas makes. Mesh's
 * `fetchAccountInfo` must not be used here: it reports
 * `active || active_epoch !== null`, and `active_epoch` keeps the epoch of
 * the last registration after a deregistration, so a deregistered account
 * comes back "active" and a delegation built on that answer is rejected by
 * the node (StakeKeyNotRegisteredDELEG) only after every signature is in.
 *
 * Blockfrost answers 404 for an account that has never appeared on chain,
 * which means "not active" rather than a failure. Anything else is
 * rethrown: a caller deciding whether to add a registration must not guess
 * when the lookup itself failed.
 */
export async function fetchStakeAccountStatus(
  provider: AccountProvider,
  rewardAddress: string,
): Promise<StakeAccountStatus> {
  try {
    const data = (await provider.get(`/accounts/${rewardAddress.trim()}`)) as
      | BlockfrostAccount
      | null
      | undefined;
    return { active: data?.active === true, poolId: data?.pool_id ?? null };
  } catch (error) {
    if (isNotFound(error)) return { active: false, poolId: null };
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    (error as { status?: number })?.status === 404 ||
    (error instanceof Error && error.message.includes("404"))
  );
}
