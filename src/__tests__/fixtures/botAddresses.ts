import { randomBytes } from "crypto";
import { CredentialType, EnterpriseAddress, Hash28ByteBase16 } from "@meshsdk/core-cst";

/**
 * Real CIP-19 bech32 addresses for bot identity tests, built from
 * repeated-byte key/script hashes. botAuth/botRegister parse what they bind,
 * so placeholder strings no longer pass.
 */
export const BOT_ADDRESSES = {
  // base address, key payment + key stake, preprod/testnet (network 0)
  base: "addr_test1qz424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasmdp8x6",
  otherBase:
    "addr_test1qrxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwsj7ull9",
  enterprise: "addr_test1vrhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwams8feqqp",
  enterpriseScript: "addr_test1wrllllllllllllllllllllllllllllllllllllllllllllc98kv7s",
  mainnetBase:
    "addr1qx424242424242424242424242424242424242424242424mhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwascmu829",
  stake: "stake_test1uzamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwc40u6yl",
  stakeMainnet: "stake1uxamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwcj9kcqz",
  stakeScript: "stake_test17zvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxgllu68q",
} as const;

/**
 * A fresh, valid testnet enterprise address for tests that write BotUser rows
 * to a shared database (paymentAddress is unique there).
 */
export function uniqueBotAddress(): string {
  return EnterpriseAddress.fromCredentials(0, {
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(randomBytes(28).toString("hex")),
  })
    .toAddress()
    .toBech32();
}
