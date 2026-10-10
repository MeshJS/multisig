import { csl } from "@meshsdk/core-csl";

export type AuthTokenAuditResult =
  | { ok: true; tokenOutputs: number }
  | { ok: false; violations: string[] };

function addressToHex(address: string): string {
  const trimmed = address.trim();
  try {
    return csl.Address.from_bech32(trimmed).to_hex();
  } catch {
    return csl.Address.from_hex(trimmed).to_hex();
  }
}

/**
 * Independent safety check on a finished transaction for a wallet with proxy auth
 * tokens. It decodes the CBOR (not the builder's own bookkeeping) and verifies that
 * every output carrying one of `authTokenIds` is at the multisig wallet address.
 * Burns are allowed (no token outputs); anything that moves a token elsewhere is a
 * violation.
 *
 * Why this exists: the deployed proxy validator passes whenever *some* output carries
 * the auth-token policy, with no signer check. A token that lands anywhere other than
 * the wallet address (notably the proxy address itself, as change) makes the proxy
 * drainable by anyone. Builders conserve tokens by construction; this is the
 * defense-in-depth layer that catches a regression, an imported transaction, or a
 * transaction built by external tooling before signers put a witness on it.
 *
 * Deliberately address-only: how many tokens share one wallet output is a pool-hygiene
 * concern handled by the builders (split for spend/DRep/vote, bundled for the cleanup
 * sweep), not a security boundary. Refusing bundled outputs here would also block
 * ordinary wallet transfers whose coin selection happened to sweep token UTxOs into
 * change.
 *
 * Fails closed: undecodable CBOR or an unparsable wallet address is a violation.
 */
export function auditAuthTokenOutputs(args: {
  txCbor: string;
  authTokenIds: string[];
  walletAddress: string;
}): AuthTokenAuditResult {
  const policyIds = Array.from(
    new Set(args.authTokenIds.map((id) => id.trim().toLowerCase()).filter(Boolean)),
  );
  if (policyIds.length === 0) {
    return { ok: true, tokenOutputs: 0 };
  }

  let walletAddressHex: string;
  try {
    walletAddressHex = addressToHex(args.walletAddress);
  } catch {
    return { ok: false, violations: ["wallet address could not be parsed"] };
  }

  let outputs: ReturnType<ReturnType<ReturnType<typeof csl.Transaction.from_hex>["body"]>["outputs"]>;
  try {
    outputs = csl.Transaction.from_hex(args.txCbor.trim()).body().outputs();
  } catch {
    return { ok: false, violations: ["transaction CBOR could not be decoded"] };
  }

  const violations: string[] = [];
  let tokenOutputs = 0;

  for (let i = 0; i < outputs.len(); i++) {
    const output = outputs.get(i);
    const multiasset = output.amount().multiasset();
    if (!multiasset) continue;

    for (const policyId of policyIds) {
      let assets: ReturnType<typeof multiasset.get>;
      try {
        assets = multiasset.get(csl.ScriptHash.from_hex(policyId));
      } catch {
        violations.push(`auth token policy ${policyId} is not a valid script hash`);
        continue;
      }
      if (!assets) continue;

      let quantity = 0n;
      const names = assets.keys();
      for (let j = 0; j < names.len(); j++) {
        const amount = assets.get(names.get(j));
        if (amount) quantity += BigInt(amount.to_str());
      }
      if (quantity === 0n) continue;

      tokenOutputs += 1;
      const outputAddressHex = output.address().to_hex();
      if (outputAddressHex !== walletAddressHex) {
        violations.push(
          `output #${i} sends ${quantity.toString()} auth token(s) of ${policyId} to an address other than the multisig wallet`,
        );
      }
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true, tokenOutputs };
}

export function formatAuthTokenAuditError(result: { violations: string[] }): string {
  return `Transaction moves a proxy auth token away from the wallet address: ${result.violations.join("; ")}`;
}
