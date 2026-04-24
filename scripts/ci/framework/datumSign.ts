import type { CIBootstrapContext } from "./types";
import { deriveSignerFromMnemonic } from "./walletAuth";

export async function signDatumWithMnemonic(args: {
  ctx: CIBootstrapContext;
  mnemonic: string;
  datum: string;
}): Promise<{
  signerAddress: string;
  key: string;
  signature: string;
}> {
  const signer = await deriveSignerFromMnemonic({
    ctx: args.ctx,
    mnemonic: args.mnemonic,
  });
  const signature = await signer.signData(args.datum);
  return {
    signerAddress: signer.signerAddress,
    key: signature.key,
    signature: signature.signature,
  };
}

