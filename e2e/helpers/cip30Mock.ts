// Phase 2: Browser-injectable CIP-0030 wallet mock.
// Injects window.cardano[walletName] driven by Node.js bridge functions
// registered via page.exposeFunction() before page.goto().
//
// IMPORTANT: per the CIP-0030 spec, getUsedAddresses / getUnusedAddresses /
// getChangeAddress / getRewardAddresses return HEX-encoded address bytes, not
// bech32. Mesh react 2.0's useAddress() resolves the address via
// getUsedAddressesBech32(), which runs Cardano.Address.fromBytes(HexBlob(addr)) —
// a strict hex parser that throws `Invalid string: "expected hex string"` on a
// bech32 string. That uncaught error leaves useAddress() unresolved, so the
// layout never sets userAddress and renders the public homepage instead of the
// wallet page. Always pass hex addresses here (see addressToHex in walletFixture).

export type Cip30MockParams = {
  walletName: string;
  // HEX-encoded address bytes (CIP-30 wire format), NOT bech32.
  usedAddresses: string[];
  changeAddress: string;
  rewardAddresses: string[];
};

export function buildCip30MockScript(params: Cip30MockParams): string {
  return `
    (function() {
      var params = ${JSON.stringify(params)};
      window.cardano = window.cardano || {};
      window.cardano[params.walletName] = {
        name: 'MeshCI',
        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>',
        apiVersion: '0.1.0',
        isEnabled: async function() { return true; },
        enable: async function() {
          return {
            getBalance: async function() {
              // CBOR integer 2000000 lovelace (2 ADA) — display only.
              // 1a = uint32 tag; 001e8480 = 2000000 in hex.
              return '1a001e8480';
            },
            getUsedAddresses: async function() { return params.usedAddresses; },
            getUnusedAddresses: async function() { return []; },
            getChangeAddress: async function() { return params.changeAddress; },
            getRewardAddresses: async function() { return params.rewardAddresses; },
            getUtxos: async function() { return await window.__ci_getUtxos(); },
            signTx: async function(cbor, partial) {
              return await window.__ci_signTx(cbor, !!partial);
            },
            signData: async function(addr, payload) {
              return await window.__ci_signData(addr, payload);
            },
            submitTx: async function(cbor) {
              return await window.__ci_submitTx(cbor);
            },
            getNetworkId: async function() { return 0; },
            getCollateral: async function() { return []; },
          };
        },
      };
    })();
  `;
}
