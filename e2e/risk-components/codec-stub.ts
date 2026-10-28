// Only the crypto boundary is stubbed in the browser harness. txRiskReview.test.ts
// exercises the same action guard with the real SDK and serialized transactions.
export const resolveTxHash = (hex: string) => {
  if (hex !== window.riskFixture.unsignedTx)
    throw new Error("Unexpected transaction bytes");
  return window.riskFixture.txHash;
};
