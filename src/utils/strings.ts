export function getFirstAndLast(
  value: string,
  firstN: number = 15,
  lastN: number = 6,
) {
  return `${value.slice(0, firstN)}...${value.slice(-lastN)}`;
}

export function truncateTokenSymbol(
  symbol: string,
  maxLength: number = 20,
  firstN: number = 8,
  lastN: number = 6,
): string {
  if (symbol.length <= maxLength) {
    return symbol;
  }
  return `${symbol.slice(0, firstN)}...${symbol.slice(-lastN)}`;
}

export function numberWithCommas(x: number) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function lovelaceToAda(lovelace: number | string) {
  return `₳ ${Math.floor((parseInt(String(lovelace)) / 1000000) * 100) / 100}`;
}

export function dateToFormatted(date: Date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
}
