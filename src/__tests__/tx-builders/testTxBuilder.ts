import { MeshTxBuilder } from "@meshsdk/core";
import { createMockProvider } from "./mockProvider";

export function getTestTxBuilder(overrides?: Parameters<typeof createMockProvider>[0]) {
  const provider = createMockProvider(overrides);
  return new MeshTxBuilder({
    fetcher: provider as any,
    evaluator: provider as any,
  });
}
