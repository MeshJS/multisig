import { describe, expect, it } from "@jest/globals";
import {
  boundAddressNetworkId,
  checkBotPaymentAddress,
  checkBotStakeAddress,
} from "@/lib/auth/botAddress";
import { BOT_ADDRESSES } from "./fixtures/botAddresses";

describe("checkBotPaymentAddress — what a bot may bind as its identity", () => {
  it.each([
    ["a testnet base address", BOT_ADDRESSES.base, 0],
    ["an enterprise address", BOT_ADDRESSES.enterprise, 0],
    ["a mainnet base address", BOT_ADDRESSES.mainnetBase, 1],
  ])("accepts %s and reports its network", (_label, address, networkId) => {
    expect(checkBotPaymentAddress(address)).toEqual({ ok: true, networkId });
  });

  it("rejects a script address: nobody can sign for it as the bot", () => {
    const check = checkBotPaymentAddress(BOT_ADDRESSES.enterpriseScript);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(/key-hash payment credential/);
  });

  it("rejects a stake address passed as the payment address", () => {
    expect(checkBotPaymentAddress(BOT_ADDRESSES.stake).ok).toBe(false);
  });

  it.each([
    ["a 20+ char string that is not bech32", "addr_test1qpbot00000000000000000000000000000000000"],
    ["a bech32 address with a broken checksum", BOT_ADDRESSES.base.slice(0, -1) + "x"],
    ["the empty string", ""],
    ["hex address bytes", "00" + "aa".repeat(28) + "bb".repeat(28)],
  ])("rejects %s", (_label, address) => {
    expect(checkBotPaymentAddress(address).ok).toBe(false);
  });

  it("rejects the upper-case spelling so one key cannot be bound under two strings", () => {
    expect(checkBotPaymentAddress(BOT_ADDRESSES.base.toUpperCase()).ok).toBe(false);
  });
});

describe("checkBotStakeAddress — the bot's stake key for new wallets", () => {
  it("accepts a key-based stake address on the payment address's network", () => {
    expect(checkBotStakeAddress(BOT_ADDRESSES.stake, 0)).toEqual({ ok: true, networkId: 0 });
  });

  it("accepts it without a network to compare against", () => {
    expect(checkBotStakeAddress(BOT_ADDRESSES.stakeMainnet)).toEqual({ ok: true, networkId: 1 });
  });

  it("rejects a stake address on a different network from the payment address", () => {
    const check = checkBotStakeAddress(BOT_ADDRESSES.stakeMainnet, 0);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(/different networks/);
  });

  it.each([
    ["a script stake address", BOT_ADDRESSES.stakeScript],
    ["a payment address", BOT_ADDRESSES.base],
    ["garbage", "stake1_optional"],
  ])("rejects %s", (_label, address) => {
    expect(checkBotStakeAddress(address).ok).toBe(false);
  });
});

describe("boundAddressNetworkId", () => {
  it("returns the network of a valid bound address", () => {
    expect(boundAddressNetworkId(BOT_ADDRESSES.mainnetBase)).toBe(1);
  });

  it("returns undefined for a legacy bound address that does not parse, instead of throwing", () => {
    expect(boundAddressNetworkId("addr_test1qpbot00000000000000000000000000000000000")).toBeUndefined();
  });
});
