import { describe, it, expect, jest, afterEach } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import {
  buildProxySetupTx,
  buildProxyDRepCertificateTx,
  buildProxyVoteTx,
  buildProxySpendTx,
  deriveProxyScripts,
} from "@/lib/proxy/txBuilders";
import {
  selectProxyUtxosForOutputs,
  selectAuthTokenUtxo,
} from "@/lib/proxy/utxoUtils";
import {
  FIXTURE_COLLATERAL,
  PARAM_UTXO,
  CHANGE_ADDRESS,
} from "./tx-builders/fixtures";
import { createMockProvider } from "./tx-builders/mockProvider";

// ─── Mesh Builder Mock ────────────────────────────────────────────────────────

interface BuilderCall { method: string; args: unknown[] }

function createMeshMock(provider: ReturnType<typeof createMockProvider>) {
  const calls: BuilderCall[] = [];
  const mesh: any = new Proxy({}, {
    get(_t, method: string) {
      if (method === "fetcher") return provider;
      if (method === "evaluator") return provider;
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

// ─── Shared Fixtures ──────────────────────────────────────────────────────────

const LARGE_UTXO: UTxO = {
  input: { txHash: PARAM_UTXO.txHash, outputIndex: PARAM_UTXO.outputIndex },
  output: {
    address: CHANGE_ADDRESS,
    amount: [{ unit: "lovelace", quantity: "25000000" }],
  },
};

const ANCHOR_URL = "https://example.com/drep.json";
const ANCHOR_JSON = {
  "@context": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md",
  hashAlgorithm: "blake2b-256",
  body: { givenName: "TestDRep", bio: "Test bio" },
};

const VALID_PROPOSAL_ID = "b".repeat(64) + "#0";

// ─── Cross-Verification Tests ─────────────────────────────────────────────────

describe("browser vs direct builder — identical tx calls", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("setupProxy produces the same builder calls as buildProxySetupTx", async () => {
    const provider = createMockProvider();

    // Direct path — MeshTxInitiator constructor calls setNetwork; mirror it here
    const { mesh: directMesh, calls: directCalls } = createMeshMock(provider);
    (directMesh as any).setNetwork("preprod");
    buildProxySetupTx({
      txBuilder: directMesh as never,
      network: 0,
      walletUtxos: [LARGE_UTXO],
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });

    // Browser path
    const { mesh: browserMesh, calls: browserCalls } = createMeshMock(provider);
    const contract = new MeshProxyContract(
      { mesh: browserMesh, networkId: 0, wallet: {} as any },
      {},
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: [LARGE_UTXO],
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });
    await contract.setupProxy();

    expect(browserCalls).toEqual(directCalls);
  });

  it("spendProxySimple produces the same builder calls as buildProxySpendTx", async () => {
    // The contract's proxyAddress (setProxyAddress with undefined stakeCredential) may differ
    // from deriveProxyScripts().proxyAddress (which falls back to DEFAULT_PROXY_STAKE_CREDENTIAL).
    // Obtain the authoritative proxyAddress from the contract so both paths agree.
    const tmpProvider = createMockProvider();
    const { mesh: tmpMesh } = createMeshMock(tmpProvider);
    const tmpContract = new MeshProxyContract(
      { mesh: tmpMesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    const proxyAddress = tmpContract.proxyAddress!;
    const authTokenPolicyId = tmpContract.getAuthTokenPolicyId();

    const authTokenUtxo: UTxO = {
      input: { txHash: "f".repeat(64), outputIndex: 0 },
      output: {
        address: CHANGE_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "5000000" },
          { unit: authTokenPolicyId, quantity: "1" },
        ],
      },
    };
    const proxyUtxo: UTxO = {
      input: { txHash: "a".repeat(63) + "b", outputIndex: 0 },
      output: {
        address: proxyAddress,
        amount: [{ unit: "lovelace", quantity: "5000000" }],
      },
    };
    const walletUtxos = [authTokenUtxo, FIXTURE_COLLATERAL];
    const outputs = [{ address: CHANGE_ADDRESS, unit: "lovelace", amount: "2000000" }];

    // Direct path — replicate the selection logic spendProxySimple applies
    const scripts = deriveProxyScripts({ paramUtxo: PARAM_UTXO, network: 0 });
    const provider = createMockProvider();
    const { mesh: directMesh, calls: directCalls } = createMeshMock(provider);
    (directMesh as any).setNetwork("preprod");
    const selectedProxyUtxos = selectProxyUtxosForOutputs([proxyUtxo], outputs, 500_000n);
    const selectedAuth = selectAuthTokenUtxo(walletUtxos, scripts.authTokenId);
    buildProxySpendTx({
      txBuilder: directMesh as never,
      network: 0,
      proxyAddress,
      paramUtxo: PARAM_UTXO,
      walletUtxos: [],
      proxyUtxos: selectedProxyUtxos,
      authTokenUtxo: selectedAuth,
      collateral: FIXTURE_COLLATERAL,
      outputs,
      walletAddress: CHANGE_ADDRESS,
    });

    // Browser path
    const browserProvider = createMockProvider();
    (browserProvider.fetchAddressUTxOs as any).mockResolvedValue([proxyUtxo]);
    const { mesh: browserMesh, calls: browserCalls } = createMeshMock(browserProvider);
    const contract = new MeshProxyContract(
      { mesh: browserMesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: walletUtxos,
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });
    await contract.spendProxySimple(outputs);

    expect(browserCalls).toEqual(directCalls);
  });

  it("manageProxyDrep(register) produces the same builder calls as buildProxyDRepCertificateTx", async () => {
    const scripts = deriveProxyScripts({ paramUtxo: PARAM_UTXO, network: 0 });

    const authTokenUtxo: UTxO = {
      input: { txHash: "f".repeat(64), outputIndex: 0 },
      output: {
        address: CHANGE_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "600000000" }, // 600 ADA covers 505 ADA deposit
          { unit: scripts.authTokenId, quantity: "1" },
        ],
      },
    };
    const walletUtxos = [authTokenUtxo, FIXTURE_COLLATERAL];

    // Direct path
    const provider = createMockProvider();
    const { mesh: directMesh, calls: directCalls } = createMeshMock(provider);
    (directMesh as any).setNetwork("preprod");
    buildProxyDRepCertificateTx({
      txBuilder: directMesh as never,
      network: 0,
      paramUtxo: PARAM_UTXO,
      walletUtxos,
      authTokenUtxo,
      collateral: FIXTURE_COLLATERAL,
      walletAddress: CHANGE_ADDRESS,
      action: "register",
      anchorUrl: ANCHOR_URL,
      anchorJson: ANCHOR_JSON,
    });

    // Browser path
    const { mesh: browserMesh, calls: browserCalls } = createMeshMock(provider);
    const contract = new MeshProxyContract(
      { mesh: browserMesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: walletUtxos,
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });
    await contract.manageProxyDrep("register", ANCHOR_URL, ANCHOR_JSON);

    expect(browserCalls).toEqual(directCalls);
  });

  it("voteProxyDrep produces the same builder calls as buildProxyVoteTx", async () => {
    const scripts = deriveProxyScripts({ paramUtxo: PARAM_UTXO, network: 0 });

    const authTokenUtxo: UTxO = {
      input: { txHash: "f".repeat(64), outputIndex: 0 },
      output: {
        address: CHANGE_ADDRESS,
        amount: [
          { unit: "lovelace", quantity: "5000000" },
          { unit: scripts.authTokenId, quantity: "1" },
        ],
      },
    };
    const walletUtxos = [authTokenUtxo, FIXTURE_COLLATERAL];
    const votes = [{ proposalId: VALID_PROPOSAL_ID, voteKind: "Yes" as const }];

    // Direct path
    const provider = createMockProvider();
    const { mesh: directMesh, calls: directCalls } = createMeshMock(provider);
    (directMesh as any).setNetwork("preprod");
    buildProxyVoteTx({
      txBuilder: directMesh as never,
      network: 0,
      paramUtxo: PARAM_UTXO,
      walletUtxos,
      authTokenUtxo,
      collateral: FIXTURE_COLLATERAL,
      walletAddress: CHANGE_ADDRESS,
      votes,
    });

    // Browser path
    const { mesh: browserMesh, calls: browserCalls } = createMeshMock(provider);
    const contract = new MeshProxyContract(
      { mesh: browserMesh, networkId: 0, wallet: {} as any },
      { paramUtxo: PARAM_UTXO },
    );
    jest.spyOn(contract as any, "getWalletInfoForTx").mockResolvedValue({
      utxos: walletUtxos,
      walletAddress: CHANGE_ADDRESS,
      collateral: FIXTURE_COLLATERAL,
    });
    await contract.voteProxyDrep(votes);

    expect(browserCalls).toEqual(directCalls);
  });
});
