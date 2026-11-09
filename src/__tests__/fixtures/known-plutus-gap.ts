/** Phase 0 only: known desired-behavior failures remain executable, not skipped.
 * Set PLUTUS_GAP_ASSERT_DESIRED=1 to expose the underlying assertion failures.
 * Replace each call with test() when its remediation phase implements the contract.
 * Keep setup and fixture validation outside this expected-failure boundary. */
export const knownPlutusGap =
  process.env.PLUTUS_GAP_ASSERT_DESIRED === "1" ? test : test.failing;
