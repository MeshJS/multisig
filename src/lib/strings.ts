export function getFirstAndLast(value: string, firstN: number = 5, lastN: number = 8) {
  return `${value.slice(0, firstN)}...${value.slice(-lastN)}`;
}

export function numberWithCommas(x: number) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function lovelaceToAda(lovelace: number|string) {
  return `₳ ${parseInt(String(lovelace)) / 1000000}`;
}