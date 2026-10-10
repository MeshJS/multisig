/**
 * UTxO refs locked by pending transactions (their txJson inputs). Pure so it
 * can be unit-tested without the tRPC client that `useAvailableUtxos` pulls in.
 *
 * `excludeTransactionId` frees the inputs of one pending tx — used by the
 * builder when editing it, so its own inputs count as spendable for the
 * rebuild.
 */
export function deriveBlockedUtxoRefs(
  transactions: { id: string; txJson: string }[],
  excludeTransactionId?: string,
): { hash: string; index: number }[] {
  return transactions
    .filter((tx) => tx.id !== excludeTransactionId)
    .flatMap((tx) => {
      let inputs: unknown;
      try {
        inputs = JSON.parse(tx.txJson)?.inputs;
      } catch {
        return [];
      }
      if (!Array.isArray(inputs)) return [];
      return inputs
        .filter(
          (input: any) =>
            typeof input?.txIn?.txHash === "string" &&
            typeof input?.txIn?.txIndex === "number",
        )
        .map((input: { txIn: { txHash: string; txIndex: number } }) => ({
          hash: input.txIn.txHash,
          index: input.txIn.txIndex,
        }));
    });
}
