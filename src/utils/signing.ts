import { checkSignature, generateNonce, IWallet } from "@meshsdk/core";

export async function sign(
  payload: string,
  wallet: IWallet,
  role: number = 0,
  userAddress?: string,
) {
  let address;
  switch (role) {
    case 0:
      address = userAddress;
      break;
    case 2:
      address = (await wallet.getRewardAddresses())[0];
      break;
    case 3:
      address = "dRep address from role 3.";
  }

  const nonce = generateNonce(payload);
  const signature = await wallet.signData(nonce, address);
  const result = await checkSignature(nonce, signature, address);

  return result ? signature : undefined;
}
