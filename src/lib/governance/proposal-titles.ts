/**
 * Zero-network proposal-title source: ballots already store the proposal
 * title next to each item (`items[i]` = "txHash#certIndex",
 * `itemDescriptions[i]` = title). Pure so it's unit-testable without
 * react-query harnessing.
 */
export function ballotTitleMap(
  ballots: Array<{ items: string[]; itemDescriptions: string[] }> | undefined,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const ballot of ballots ?? []) {
    ballot.items.forEach((item, index) => {
      const title = ballot.itemDescriptions[index]?.trim();
      // Ballots arrive newest-first; the first non-empty title wins.
      if (item && title && !titles.has(item)) {
        titles.set(item, title);
      }
    });
  }
  return titles;
}
