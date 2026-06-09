import {
  checkSignature,
  DataSignature,
  generateNonce,
  IWallet,
} from "@meshsdk/core";

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

  const nonce = generateNonce(payload);
  const signature = await wallet.signData(payload, address);
  const verified = await checkSignature(nonce, signature, address);

  if (!verified) {
    throw new Error("Signature failed verification");
  }

  return signature;
}
