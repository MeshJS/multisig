import { describe, it, expect, jest } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { createMockProvider } from "./mockProvider";
import {
  FIXTURE_UTXOS,
  FIXTURE_COLLATERAL,
  CHANGE_ADDRESS,
  PARAM_UTXO,
} from "./fixtures";

// ─── Proxy Mesh Builder Mock ──────────────────────────────────────────────────

interface BuilderCall { method: string; args: unknown[] }

/**
 * Creates a Proxy that intercepts every method call on the mesh builder,
 * records it in `calls`, and returns itself for chaining.
 * Also exposes `fetcher`/`evaluator` so contract methods that check
 * `this.mesh.fetcher` don't throw "Blockchain provider not found".
 */
function createMeshMock(provider: ReturnType<typeof createMockProvider>) {
  const calls: BuilderCall[] = [];
  const mesh: any = new Proxy({}, {
    get(_t, method: string) {
      if (method === "fetcher") return provider;
      if (method === "evaluator") return provider;
      // Returning a function for `then` would make the Proxy look like a
      // thenable, causing Promise.resolve(mesh) inside async contract methods
      // to hang indefinitely. Return undefined to mark it as a plain value.
      if (method === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ method, args });
        return mesh;
      };
    },
    set() { return true; },
  });
  return { mesh, calls };
}

// ─── Contract Factories ───────────────────────────────────────────────────────

function makeSetupContract() {
  const provider = createMockProvider();
  const { mesh, calls } = createMeshMock(provider);
  const contract = new MeshProxyContract(
    { mesh, networkId: 0, wallet: {} as any },
    {},
  );
  return { contract, calls };
}

/**
 * Contract pre-configured with PARAM_UTXO so proxyAddress is set in constructor.
 * getWalletInfoForTx is mocked to return an auth token UTxO plus fixture UTxOs.
 */
function makeManageContract(extraWalletUtxos: UTxO[] = []) {
  const provider = createMockProvider();
  const { mesh, calls } = createMeshMock(provider);
  const contract = new MeshProxyContract(
    { mesh, networkId: 0, wallet: {} as any },
    { paramUtxo: PARAM_UTXO },
  );

  const authPolicyId = contract.getAuthTokenPolicyId();

  // Auth token unit = policyId with empty name (matches how setupProxy mints)
  const authTokenUtxo: UTxO = {
    input: { txHash: "f".repeat(64), outputIndex: 0 },
    output: {
      address: CHANGE_ADDRESS,
      amount: [
        { unit: "lovelace", quantity: "600000000" }, // 600 ADA covers register (505 ADA)
        { unit: authPolicyId, quantity: "1" },
      ],
    },
  };

  // FIXTURE_COLLATERAL (5 ADA) satisfies voteProxyDrep's ≥5 ADA collateral search
  const walletUtxos = [authTokenUtxo, FIXTURE_COLLATERAL, ...FIXTURE_UTXOS, ...extraWalletUtxos];

  jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
    utxos: walletUtxos,
    walletAddress: CHANGE_ADDRESS,
    collateral: FIXTURE_COLLATERAL,
  });

  return { contract, calls, authPolicyId };
}

// ─── Shared Fixtures ──────────────────────────────────────────────────────────

// txHash matches PARAM_UTXO so auth token policyId is stable after setupProxy
const LARGE_UTXO: UTxO = {
  input: { txHash: PARAM_UTXO.txHash, outputIndex: PARAM_UTXO.outputIndex },
  output: {
    address: CHANGE_ADDRESS,
    amount: [{ unit: "lovelace", quantity: "25000000" }],
  },
};

const ANCHOR = {
  anchorUrl: "https://example.com/drep.json",
  anchorDataHash: "0".repeat(64),
};

const VALID_PROPOSAL_ID = "b".repeat(64) + "#0";
const VALID_PROPOSAL_ID_2 = "c".repeat(64) + "#1";

// ─── Pure Computation Tests ───────────────────────────────────────────────────

describe("MeshProxyContract — pure computations", () => {
  it("getAuthTokenPolicyId returns a 56-char lowercase hex string", () => {
    const { contract } = makeManageContract();
    const policyId = contract.getAuthTokenPolicyId();
    expect(typeof policyId).toBe("string");
    expect(policyId).toHaveLength(56);
    expect(policyId).toMatch(/^[0-9a-f]+$/);
  });

  it("getAuthTokenPolicyId is deterministic for the same paramUtxo", () => {
    const { contract: a } = makeManageContract();
    const { contract: b } = makeManageContract();
    expect(a.getAuthTokenPolicyId()).toBe(b.getAuthTokenPolicyId());
  });

  it("getDrepId returns a string starting with drep1", () => {
    const { contract } = makeManageContract();
    const drepId = contract.getDrepId();
    expect(typeof drepId).toBe("string");
    expect(drepId.startsWith("drep1")).toBe(true);
  });

  it("setProxyAddress returns addr_test1... for networkId 0 and stores proxyAddress", () => {
    const { contract } = makeManageContract();
    const addr = contract.setProxyAddress();
    expect(addr.startsWith("addr_test1")).toBe(true);
    expect(contract.proxyAddress).toBe(addr);
  });
});

// ─── setupProxy Tests ─────────────────────────────────────────────────────────

describe("MeshProxyContract.setupProxy", () => {
  it("mints exactly 10 auth tokens using the correct policyId", async () => {
    const { contract, calls } = makeSetupContract();
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: [LARGE_UTXO],
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    const result = await contract.setupProxy();

    const mintCall = calls.find(c => c.method === "mint");
    expect(mintCall).toBeDefined();
    expect(mintCall!.args[0]).toBe("10");
    expect(mintCall!.args[1]).toBe(result.authTokenId);
  });

  it("sends an output to the proxy address", async () => {
    const { contract, calls } = makeSetupContract();
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: [LARGE_UTXO],
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    const result = await contract.setupProxy();

    const proxyOut = calls.filter(c => c.method === "txOut").find(c => c.args[0] === result.proxyAddress);
    expect(proxyOut).toBeDefined();
  });

  it("returns paramUtxo matching the selected input", async () => {
    const { contract } = makeSetupContract();
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: [LARGE_UTXO],
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    const result = await contract.setupProxy();

    expect(result.paramUtxo).toEqual(LARGE_UTXO.input);
  });

  it("throws when no UTxO holds at least 20 ADA", async () => {
    const { contract } = makeSetupContract();
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: FIXTURE_UTXOS, // max 10 ADA
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    await expect(contract.setupProxy()).rejects.toThrow("Insufficicient balance");
  });
});

// ─── manageProxyDrep Tests ────────────────────────────────────────────────────

describe("MeshProxyContract.manageProxyDrep", () => {
  it("register calls drepRegistrationCertificate with drepId and anchor", async () => {
    const { contract, calls } = makeManageContract();
    await contract.manageProxyDrep("register", ANCHOR.anchorUrl, ANCHOR.anchorDataHash);

    const certCall = calls.find(c => c.method === "drepRegistrationCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(contract.getDrepId());
    expect(certCall!.args[1]).toEqual({ anchorUrl: ANCHOR.anchorUrl, anchorDataHash: ANCHOR.anchorDataHash });
  });

  it("deregister calls drepDeregistrationCertificate with drepId", async () => {
    const { contract, calls } = makeManageContract();
    await contract.manageProxyDrep("deregister");

    const certCall = calls.find(c => c.method === "drepDeregistrationCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(contract.getDrepId());
  });

  it("update calls drepUpdateCertificate with drepId and anchor", async () => {
    const { contract, calls } = makeManageContract();
    await contract.manageProxyDrep("update", ANCHOR.anchorUrl, ANCHOR.anchorDataHash);

    const certCall = calls.find(c => c.method === "drepUpdateCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(contract.getDrepId());
    expect(certCall!.args[1]).toEqual({ anchorUrl: ANCHOR.anchorUrl, anchorDataHash: ANCHOR.anchorDataHash });
  });

  it("register without anchor throws", async () => {
    const { contract } = makeManageContract();
    await expect(
      contract.manageProxyDrep("register"),
    ).rejects.toThrow("Anchor URL and hash are required");
  });

  it("update without anchor throws", async () => {
    const { contract } = makeManageContract();
    await expect(
      contract.manageProxyDrep("update"),
    ).rejects.toThrow("Anchor URL and hash are required");
  });

  it("throws when auth token is absent from wallet UTxOs", async () => {
    const provider = createMockProvider();
    const { mesh } = createMeshMock(provider);
    const contract = new MeshProxyContract(
      { mesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: FIXTURE_UTXOS, // no auth token
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    await expect(
      contract.manageProxyDrep("deregister"),
    ).rejects.toThrow("No AuthToken found");
  });

  it("adds certificateScript with the proxy CBOR", async () => {
    const { contract, calls } = makeManageContract();
    await contract.manageProxyDrep("deregister");

    expect(calls.find(c => c.method === "certificateScript")).toBeDefined();
  });

  it("sets changeAddress to the wallet address", async () => {
    const { contract, calls } = makeManageContract();
    await contract.manageProxyDrep("deregister");

    const changeCall = calls.find(c => c.method === "changeAddress");
    expect(changeCall).toBeDefined();
    expect(changeCall!.args[0]).toBe(CHANGE_ADDRESS);
  });
});

// ─── voteProxyDrep Tests ──────────────────────────────────────────────────────

describe("MeshProxyContract.voteProxyDrep", () => {
  it("throws when votes array is empty", async () => {
    const { contract } = makeManageContract();
    await expect(contract.voteProxyDrep([])).rejects.toThrow("No votes provided");
  });

  it("calls vote once for a single Yes vote", async () => {
    const { contract, calls } = makeManageContract();
    await contract.voteProxyDrep([
      { proposalId: VALID_PROPOSAL_ID, voteKind: "Yes" },
    ]);

    const voteCalls = calls.filter(c => c.method === "vote");
    expect(voteCalls).toHaveLength(1);
    expect(voteCalls[0]!.args[2]).toEqual({ voteKind: "Yes" });
  });

  it("calls vote for each proposal in a multi-vote array", async () => {
    const { contract, calls } = makeManageContract();
    await contract.voteProxyDrep([
      { proposalId: VALID_PROPOSAL_ID, voteKind: "Yes" },
      { proposalId: VALID_PROPOSAL_ID_2, voteKind: "No" },
    ]);

    const voteCalls = calls.filter(c => c.method === "vote");
    expect(voteCalls).toHaveLength(2);
  });

  it("passes the contract DRep ID to every vote call", async () => {
    const { contract, calls } = makeManageContract();
    const drepId = contract.getDrepId();

    await contract.voteProxyDrep([
      { proposalId: VALID_PROPOSAL_ID, voteKind: "Abstain" },
    ]);

    const voteCall = calls.find(c => c.method === "vote");
    expect(voteCall!.args[0]).toEqual({ type: "DRep", drepId });
  });

  it("throws when auth token is absent from wallet UTxOs", async () => {
    const provider = createMockProvider();
    const { mesh } = createMeshMock(provider);
    const contract = new MeshProxyContract(
      { mesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: FIXTURE_UTXOS, // no auth token; 10 ADA UTxO satisfies ≥5 ADA collateral check
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    await expect(
      contract.voteProxyDrep([{ proposalId: VALID_PROPOSAL_ID, voteKind: "Yes" }]),
    ).rejects.toThrow("No AuthToken found");
  });

  it("throws for a malformed proposal ID", async () => {
    const { contract } = makeManageContract();
    await expect(
      contract.voteProxyDrep([{ proposalId: "invalid-id", voteKind: "Yes" }]),
    ).rejects.toThrow("Invalid proposal ID format");
  });
});
