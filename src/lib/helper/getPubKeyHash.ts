import { Bip32PublicKey } from "@emurgo/cardano-serialization-lib-browser";

export const getPubKeyHash = (xvk: string): string => {
  try {
    const bip32Pub = Bip32PublicKey.from_hex(xvk);
    return bip32Pub.to_raw_key().hash().to_hex();
  } catch (error) {
    console.error("Error generating pub key hash", error);
    return "";
  }
};