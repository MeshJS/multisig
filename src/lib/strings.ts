export function getFirstAndLast(value: string, n: number = 10) {
  return `${value.slice(0, n)}...${value.slice(-n)}`;
}

export function numberWithCommas(x: number) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
