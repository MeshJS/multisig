import { checkSignature, DataSignature, IWallet } from "@meshsdk/core";

export type SignRole = 0 | 2 | 3;

export async function sign(
  payload: string,
  wallet: IWallet,
  role: SignRole = 0,
  userAddress?: string,
  dRepAddress?: string,
): Promise<DataSignature> {
  let address: string | undefined;
  switch (role) {
    case 0:
      address = userAddress;
      break;
    case 2:
      address = (await wallet.getRewardAddresses())[0];
      break;
    case 3:
      address = dRepAddress;
      break;
    default: {
      const _exhaustive: never = role;
      throw new Error(`sign: unsupported role ${String(_exhaustive)}`);
    }
  }

  if (!address) {
    throw new Error("sign: missing address for the chosen role");
  }

  const signature = await wallet.signData(payload, address);
  // Verify against the payload itself — the exact bytes the wallet signed.
  // This previously checked against `generateNonce(payload)`, which returns
  // `hex(payload + 32 random characters)`; that can never equal the COSE
  // payload, so every honest signature failed here and the throw below fired
  // on every call. A nonce belongs to a server-issued challenge flow, where
  // the nonce IS the signed message. Here the caller's payload already carries
  // its own replay protection (the sign-off statement embeds `signedAt`, which
  // the server checks against a ten-minute window).
  const verified = await checkSignature(payload, signature, address);

  if (!verified) {
    throw new Error("Signature failed verification");
  }

  return signature;
}
