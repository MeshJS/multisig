export function getFirstAndLast(
  value: string,
  firstN: number = 5,
  lastN: number = 12,
) {
  return `${value.slice(0, firstN)}...${value.slice(-lastN)}`;
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
