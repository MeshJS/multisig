// Phase 2: Browser-injectable CIP-0030 wallet mock.
// Injects window.cardano[walletName] driven by Node.js bridge functions
// registered via page.exposeFunction() before page.goto().

export type Cip30MockParams = {
  walletName: string;
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
              // Minimal CBOR for a Value of 2 ADA — used for display only
              return 'a200a1581c\\0041\\00a1\\00021a001e8480';
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
