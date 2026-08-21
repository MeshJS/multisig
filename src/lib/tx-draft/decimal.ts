/**
 * Exact display↔base unit conversion for asset amounts using decimal-string
 * math — no parseFloat, so amounts like 1.123456 ADA never pick up float
 * precision errors (a known bug class in the legacy form's multiplier math).
 */

/** "1.5" with 6 decimals → "1500000"; undefined when not a valid amount. */
export function displayToBase(
  display: string,
  decimals: number,
): string | undefined {
  const trimmed = display.trim();
  if (trimmed === "" || trimmed === "." || !/^\d*(\.\d*)?$/.test(trimmed)) {
    return undefined;
  }
  const [whole = "", fraction = ""] = trimmed.split(".");
  // Extra fractional digits beyond the asset's precision are truncated.
  const scaledFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((whole || "0") + scaledFraction).toString();
}

/** "1500000" with 6 decimals → "1.5"; "" when the input is not an integer. */
export function baseToDisplay(base: string, decimals: number): string {
  let quantity: bigint;
  try {
    quantity = BigInt(base);
  } catch {
    return "";
  }
  if (decimals <= 0) return quantity.toString();
  const negative = quantity < 0n;
  const digits = (negative ? -quantity : quantity)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
