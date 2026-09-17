/**
 * Splits a completed builder body's outputs into payments and the change
 * output(s) Mesh's `complete()` appends last. Outputs are never re-sorted, so
 * the trailing run at the change address is the change — but never the whole
 * list: a consolidation transaction paying only the wallet keeps its first
 * output as the payment.
 */
export function splitTrailingChange<T extends { address?: unknown }>(
  outputs: T[],
  changeAddress: string,
): { payments: T[]; change: T[] } {
  let firstChangeIndex = outputs.length;
  while (
    changeAddress &&
    firstChangeIndex > 1 &&
    outputs[firstChangeIndex - 1]!.address === changeAddress
  ) {
    firstChangeIndex--;
  }
  return {
    payments: outputs.slice(0, firstChangeIndex),
    change: outputs.slice(firstChangeIndex),
  };
}
