import { describe, it, expect } from '@jest/globals';
import { normalizeAddressToBech32 } from '../utils/addressCompatibility';

describe('normalizeAddressToBech32', () => {
  // 57-byte mainnet base address as returned hex-encoded by some CIP-30
  // wallets (mobile in-app browsers) from getChangeAddress/getUsedAddresses.
  const mainnetBaseHex =
    '01188691447471593ad888086cd3cffcb93833f38225ebd56bb1986476b59d6e7bd1e5ae3ae5ffe52dada5528d868ef67b738687543193df8d';
  const mainnetBaseBech32 =
    'addr1qyvgdy2yw3c4jwkc3qyxe570ljunsvlnsgj7h4ttkxvxga44n4h8h5094cawtll99kk6255ds680v7mns6r4gvvnm7xscrhvw9';

  it('converts hex-encoded mainnet base address bytes to bech32', () => {
    expect(normalizeAddressToBech32(mainnetBaseHex)).toBe(mainnetBaseBech32);
  });

  it('converts hex-encoded testnet base address bytes to addr_test', () => {
    const testnetHex = '00' + mainnetBaseHex.slice(2);
    expect(normalizeAddressToBech32(testnetHex)).toMatch(/^addr_test1/);
  });

  it('converts hex-encoded reward address bytes to stake bech32', () => {
    const rewardHex = 'e1ad675b9ef479ae3ae5ffe52dada5528d868ef67b738687543193df8d';
    expect(normalizeAddressToBech32(rewardHex)).toBe(
      'stake1uxkkwku773u6uwh9lljjmtd922xcdrhk0decdp65xxfalrgc9mvct',
    );
  });

  it('returns bech32 addresses unchanged', () => {
    expect(normalizeAddressToBech32(mainnetBaseBech32)).toBe(mainnetBaseBech32);
    const stake = 'stake1uxkkwku773u6uwh9lljjmtd922xcdrhk0decdp65xxfalrgc9mvct';
    expect(normalizeAddressToBech32(stake)).toBe(stake);
  });

  it('returns non-address input unchanged', () => {
    expect(normalizeAddressToBech32('deadbeef')).toBe('deadbeef');
    expect(normalizeAddressToBech32('not-an-address')).toBe('not-an-address');
    expect(normalizeAddressToBech32('')).toBe('');
  });
});
