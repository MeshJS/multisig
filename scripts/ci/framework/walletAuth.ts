import type { CIBootstrapContext } from "./types";
import { requestJson } from "./http";
import { stringifyRedacted } from "./redact";

function parseMnemonic(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export async function deriveSignerFromMnemonic(args: {
  ctx: CIBootstrapContext;
  mnemonic: string;
}): Promise<{
  signerAddress: string;
  signData: (payload: string) => Promise<{ key: string; signature: string }>;
}> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId: args.ctx.networkId,
    key: { type: "mnemonic", words: parseMnemonic(args.mnemonic) },
  });
  await wallet.init();
  const signerAddress = await wallet.getChangeAddress();
  return {
    signerAddress,
    signData: async (payload: string) => {
      const signature = await wallet.signData(payload, signerAddress);
      return {
        key: signature.key,
        signature: signature.signature,
      };
    },
  };
}

export async function authenticateSignerWithMnemonic(args: {
  ctx: CIBootstrapContext;
  mnemonic: string;
}): Promise<{
  token: string;
  signerAddress: string;
  nonce: string;
}> {
  const signer = await deriveSignerFromMnemonic(args);
  const nonceResponse = await requestJson<{ nonce?: string; error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/getNonce?address=${encodeURIComponent(signer.signerAddress)}`,
    method: "GET",
  });
  if (nonceResponse.status !== 200 || typeof nonceResponse.data?.nonce !== "string") {
    throw new Error(
      `getNonce failed (${nonceResponse.status}): ${stringifyRedacted(nonceResponse.data)}`,
    );
  }

  const signed = await signer.signData(nonceResponse.data.nonce);
  const authResponse = await requestJson<{ token?: string; error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/authSigner`,
    method: "POST",
    body: {
      address: signer.signerAddress,
      signature: signed.signature,
      key: signed.key,
    },
  });
  if (authResponse.status !== 200 || typeof authResponse.data?.token !== "string") {
    throw new Error(
      `authSigner failed (${authResponse.status}): ${stringifyRedacted(authResponse.data)}`,
    );
  }

  return {
    token: authResponse.data.token,
    signerAddress: signer.signerAddress,
    nonce: nonceResponse.data.nonce,
  };
}

