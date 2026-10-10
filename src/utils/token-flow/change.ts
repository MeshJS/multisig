/**
 * Splits a completed builder body's outputs into payments and the change
 * output(s) Mesh's `complete()` appends last. Outputs are never re-sorted, so
 * the trailing run at the change address is the change.
 *
 * `paymentCount` is how many leading outputs the caller intended as payments
 * (a draft's or spec's output count). With it, a certificate-only transaction
 * (zero payments, one change output) is classified correctly. Without it the
 * split never takes the whole list: a consolidation transaction paying only
 * the wallet keeps its first output as the payment.
 */
export function splitTrailingChange<T extends { address?: unknown }>(
  outputs: T[],
  changeAddress: string,
  paymentCount?: number,
): { payments: T[]; change: T[] } {
  const floor = Math.max(0, paymentCount ?? 1);
  let firstChangeIndex = outputs.length;
  while (
    changeAddress &&
    firstChangeIndex > floor &&
    outputs[firstChangeIndex - 1]!.address === changeAddress
  ) {
    firstChangeIndex--;
  }
  return {
    payments: outputs.slice(0, firstChangeIndex),
    change: outputs.slice(firstChangeIndex),
  };
}
