/** The raw REST accessor (`BlockfrostProvider.get`), not the typed wrappers. */
type AccountProvider = {
  get: (url: string) => Promise<unknown>;
};

/**
 * The DRep a stake credential currently delegates its vote to, or null when
 * it has none.
 *
 * Reads the same Blockfrost `/accounts/{stake}` record the staking page reads
 * for its "already delegated" check, so the v1 builder and the UI agree on
 * whether a pool delegation needs a vote delegation paired with it. Only a
 * registered (`active`) account counts: deregistration clears the ledger's
 * vote delegation, and a stale `drep_id` on an inactive record must not stop
 * a new delegation from getting its DRep.
 *
 * A 404 means the account has never appeared on chain, so there is no
 * delegation to keep. Any other failure is rethrown: the caller is deciding
 * whether to overwrite a governance choice, and must not guess "none" when
 * the lookup itself failed.
 */
export async function fetchVoteDelegation(
  provider: AccountProvider,
  rewardAddress: string,
): Promise<string | null> {
  try {
    const data = (await provider.get(`/accounts/${rewardAddress.trim()}`)) as
      | { active?: boolean; drep_id?: string | null }
      | null
      | undefined;
    if (data?.active !== true) return null;
    const dRepId = data.drep_id;
    return typeof dRepId === "string" && dRepId ? dRepId : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Mesh's `BlockfrostProvider.get` rejects with a JSON *string*
 * (`{"data":{"status_code":404,…},"headers":…,"status":404}`), not an Error,
 * so the string is parsed; object rejections are accepted too.
 */
function isNotFound(error: unknown): boolean {
  let value: unknown = error;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  const e = value as { status?: unknown; data?: { status_code?: unknown } };
  return e.status === 404 || e.data?.status_code === 404;
}
