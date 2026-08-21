/**
 * Derive signer payment addresses from mnemonics using MeshWallet.
 */

export async function derivePaymentAddress(
  mnemonic: string[],
  networkId: 0 | 1,
): Promise<string> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId,
    key: { type: "mnemonic", words: mnemonic },
  });
  await wallet.init();
  return wallet.getChangeAddress();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function mnemonicFromEnv(envName: string): string[] {
  const raw = requireEnv(envName);
  const words = raw.trim().split(/\s+/);
  if (words.length < 12) {
    throw new Error(`${envName} must contain at least 12 mnemonic words`);
  }
  return words;
}
