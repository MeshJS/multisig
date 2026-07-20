// Phase 2: Node.js MeshWallet signing bridge.
// Called from walletFixture as the handler for window.__ci_signTx() and
// window.__ci_signData() bridge calls from the browser.

function parseMnemonic(str: string): string[] {
  return str.trim().split(/\s+/).filter(Boolean);
}

export async function signWithMnemonic(
  mnemonic: string,
  txCbor: string,
  partial: boolean,
): Promise<string> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId: 0,
    key: { type: "mnemonic", words: parseMnemonic(mnemonic) },
  });
  await wallet.init();
  // The injected browser object is a CIP-30 wallet. CIP-30 signTx returns a
  // TransactionWitnessSet, and Mesh BrowserWallet wraps that witness set into
  // the full transaction. Returning a full transaction here makes BrowserWallet
  // try to parse a transaction as a witness set, which fails with CBOR major
  // type mismatch errors.
  return wallet.signTx(txCbor, partial, false);
}

export async function signDataWithMnemonic(
  mnemonic: string,
  dataToSign: string,
  signingAddress: string,
): Promise<{ signature: string; key: string }> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId: 0,
    key: { type: "mnemonic", words: parseMnemonic(mnemonic) },
  });
  await wallet.init();
  // MeshWallet.signData(payload, address): first arg is data to sign, second is the bech32
  // signing address. EmbeddedWallet uses the address to look up the correct private key.
  const result = await wallet.signData(dataToSign, signingAddress);
  return { signature: result.signature, key: result.key };
}
