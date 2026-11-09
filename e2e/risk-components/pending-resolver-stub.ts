// Browser lifecycle tests inject real-codec assessments produced by the test runner.
// pendingRiskReview.test.ts covers the resolver and guard with serialized CBOR.
export const assessTransactionRisks = () =>
  structuredClone(window.riskFixture.riskAssessment!);
export const resolveTransactionRisks = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return assessTransactionRisks();
};
