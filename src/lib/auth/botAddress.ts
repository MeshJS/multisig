import { Address, AddressType, CredentialType } from "@meshsdk/core-cst";

/**
 * Validation for the addresses a bot binds as its identity (botRegister,
 * botAuth).
 *
 * The bound paymentAddress is permanent — botAuth refuses any later address
 * that differs from it — and it becomes the bot's signer address in every
 * wallet it joins, where createWallet resolves its payment key hash. A typo,
 * a script address or a stake address used to pass the old "at least 20
 * characters" check and left the bot locked to an identity it can never sign
 * for. So the address has to be checked when it is bound, not when it is
 * first used.
 */

export type BotAddressCheck =
  | { ok: true; networkId: number }
  | { ok: false; message: string };

// Address types whose payment part can be a key hash (CIP-19). Reward
// addresses carry a stake credential only, Byron addresses have no bech32 form.
const PAYMENT_ADDRESS_TYPES = new Set<AddressType>([
  AddressType.BasePaymentKeyStakeKey,
  AddressType.BasePaymentKeyStakeScript,
  AddressType.BasePaymentScriptStakeKey,
  AddressType.BasePaymentScriptStakeScript,
  AddressType.PointerKey,
  AddressType.PointerScript,
  AddressType.EnterpriseKey,
  AddressType.EnterpriseScript,
]);

function parseBech32(value: string): Address | null {
  try {
    const address = Address.fromBech32(value);
    // bech32 is case-insensitive, but the bound address is compared as a
    // string (botAuth, BotUser.paymentAddress @unique, wallet signer lists).
    // Accept only the canonical lowercase form so one key cannot be bound
    // under two spellings.
    return address.toBech32() === value ? address : null;
  } catch {
    return null;
  }
}

/**
 * A bot signs with a key, so its payment credential must be a key hash —
 * a script address has nobody who could produce the witness.
 */
export function checkBotPaymentAddress(value: string): BotAddressCheck {
  const address = parseBech32(value);
  if (!address || !PAYMENT_ADDRESS_TYPES.has(address.getType())) {
    return {
      ok: false,
      message: "paymentAddress must be a bech32 Cardano payment address (addr1… / addr_test1…)",
    };
  }
  if (address.getProps().paymentPart?.type !== CredentialType.KeyHash) {
    return {
      ok: false,
      message: "paymentAddress must have a key-hash payment credential; script addresses cannot sign",
    };
  }
  return { ok: true, networkId: address.getNetworkId() };
}

/**
 * The stake address lands in the owner's new-wallet signer list as the bot's
 * stake key, where it is resolved to a stake key hash — so it must be a
 * key-based reward address on the same network as the payment address.
 */
export function checkBotStakeAddress(
  value: string,
  paymentNetworkId?: number,
): BotAddressCheck {
  const address = parseBech32(value);
  if (!address || address.getType() !== AddressType.RewardKey) {
    return {
      ok: false,
      message: "stakeAddress must be a bech32 key-based stake address (stake1… / stake_test1…)",
    };
  }
  const networkId: number = address.getNetworkId();
  if (paymentNetworkId !== undefined && networkId !== paymentNetworkId) {
    return {
      ok: false,
      message: "stakeAddress and paymentAddress are on different networks",
    };
  }
  return { ok: true, networkId };
}

/**
 * Network of an address that is already bound. Bots bound before this check
 * existed may hold an address that does not parse; returning undefined lets
 * them keep authenticating (and only skips the same-network check) instead of
 * locking them out.
 */
export function boundAddressNetworkId(value: string): number | undefined {
  const check = checkBotPaymentAddress(value);
  return check.ok ? check.networkId : undefined;
}
