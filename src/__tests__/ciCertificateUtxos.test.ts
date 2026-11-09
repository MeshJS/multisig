import { requestJson } from "../../scripts/ci/framework/http";
import { authenticateBot } from "../../scripts/ci/framework/botAuth";
import {
  createScenarioDRepCertificates,
  createScenarioStakeCertificates,
} from "../../scripts/ci/scenarios/steps/certificates";
import type {
  CIBootstrapContext,
  RouteStep,
} from "../../scripts/ci/framework/types";

jest.mock("../../scripts/ci/framework/http", () => ({
  requestJson: jest.fn(),
}));
jest.mock("../../scripts/ci/framework/botAuth", () => ({
  authenticateBot: jest.fn(),
}));

const http = jest.mocked(requestJson);
const ctx: CIBootstrapContext = {
  schemaVersion: 3,
  createdAt: "2026-10-28T00:00:00.000Z",
  apiBaseUrl: "http://localhost:3000",
  networkId: 0,
  walletTypes: ["legacy", "sdk"],
  wallets: ["legacy", "sdk"].map((type) => ({
    type: type as "legacy" | "sdk",
    walletId: `${type}-wallet`,
    walletAddress: `addr_test_${type}`,
    signerAddresses: [],
  })),
  bots: [{ id: "bot", paymentAddress: "addr_test_bot", botKeyId: "key" }],
  defaultBotId: "bot",
  signerAddresses: [],
  signerStakeAddresses: [],
  stakePoolIdHex: "ab".repeat(28),
};

const utxo = (txHash: string, outputIndex = 0) => ({
  input: { txHash, outputIndex },
  output: {
    address: "addr_test_sdk",
    amount: [{ unit: "lovelace", quantity: "10000000" }],
  },
});
const spent = utxo("old");
const change = utxo("new");

function lifecycle(kind: string): RouteStep[] {
  if (kind === "stake") return createScenarioStakeCertificates().steps;
  return createScenarioDRepCertificates().parallelBranches!.find((branch) =>
    branch.id.endsWith(kind),
  )!.steps;
}

async function confirmRegistration(steps: RouteStep[]) {
  http
    .mockResolvedValueOnce({ status: 200, data: [spent] })
    .mockResolvedValueOnce({ status: 201, data: { id: "registration" } });
  await steps.find((step) => step.id.endsWith(".propose"))!.execute(ctx);
  http.mockResolvedValueOnce({ status: 200, data: [change] });
  await steps.find((step) => step.id.endsWith(".onchain"))!.execute(ctx);
  http.mockClear();
}

function proposeNext(steps: RouteStep[]) {
  return steps.filter((step) => step.id.endsWith(".propose"))[1]!.execute(ctx);
}

describe("certificate lifecycle UTxO selection", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    http.mockReset();
    jest.mocked(authenticateBot).mockResolvedValue("token");
    process.env.CI_DREP_ANCHOR_URL = "https://example.test/anchor.json";
    process.env.CI_DREP_ANCHOR_JSON = "{}";
  });

  const originalAnchorUrl = process.env.CI_DREP_ANCHOR_URL;
  const originalAnchorJson = process.env.CI_DREP_ANCHOR_JSON;
  afterEach(() => {
    jest.useRealTimers();
    if (originalAnchorUrl === undefined) delete process.env.CI_DREP_ANCHOR_URL;
    else process.env.CI_DREP_ANCHOR_URL = originalAnchorUrl;
    if (originalAnchorJson === undefined)
      delete process.env.CI_DREP_ANCHOR_JSON;
    else process.env.CI_DREP_ANCHOR_JSON = originalAnchorJson;
  });

  test.each(["stake", "legacy", "sdk"])(
    "%s waits for change when a fresh response regresses to spent inputs",
    async (kind) => {
      const steps = lifecycle(kind);
      await confirmRegistration(steps);
      http
        .mockResolvedValueOnce({ status: 200, data: [spent] })
        .mockResolvedValueOnce({ status: 200, data: [] })
        .mockResolvedValueOnce({ status: 200, data: [change] })
        .mockResolvedValueOnce({ status: 201, data: { id: "cleanup" } });

      const proposal = proposeNext(steps);
      await jest.runAllTimersAsync();
      await expect(proposal).resolves.toHaveProperty(
        "artifacts.transactionId",
        "cleanup",
      );
      const posts = http.mock.calls.filter(
        ([request]) => request.method === "POST",
      );
      expect(posts).toHaveLength(1);
      expect(posts[0]![0].body?.utxoRefs).toEqual([change.input]);
      const gets = http.mock.calls.filter(
        ([request]) => request.method === "GET",
      );
      expect(gets).toHaveLength(3);
      for (const [request] of gets)
        expect(request.url).toContain("&fresh=true");
    },
  );

  test("filters consumed outputs without discarding unspent outputs of the same transaction", async () => {
    const steps = lifecycle("stake");
    await confirmRegistration(steps);
    const sibling = utxo("old", 1);
    http
      .mockResolvedValueOnce({ status: 200, data: [spent, sibling, change] })
      .mockResolvedValueOnce({ status: 201, data: { id: "cleanup" } });
    await proposeNext(steps);
    expect(http.mock.calls[1]![0].body?.utxoRefs).toEqual([
      sibling.input,
      change.input,
    ]);
  });

  test("fails without proposing when only consumed inputs remain visible", async () => {
    const steps = lifecycle("stake");
    await confirmRegistration(steps);
    http.mockResolvedValue({ status: 200, data: [spent] });
    const rejected = expect(proposeNext(steps)).rejects.toThrow(
      /after 48 attempts/,
    );
    await jest.runAllTimersAsync();
    await rejected;
    expect(http).toHaveBeenCalledTimes(48);
    expect(http.mock.calls.every(([request]) => request.method === "GET")).toBe(
      true,
    );
  });

  test("surfaces API errors without constructing a certificate", async () => {
    const steps = lifecycle("stake");
    await confirmRegistration(steps);
    http.mockResolvedValueOnce({ status: 403, data: { error: "Forbidden" } });
    await expect(proposeNext(steps)).rejects.toThrow(
      /freeUtxos preflight failed \(403\)/,
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
});
