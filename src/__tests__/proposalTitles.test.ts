import { ballotTitleMap } from "@/lib/governance/proposal-titles";

const PID_A = `${"a".repeat(64)}#0`;
const PID_B = `${"b".repeat(64)}#2`;

describe("ballotTitleMap", () => {
  test("zips items with their descriptions", () => {
    const map = ballotTitleMap([
      {
        items: [PID_A, PID_B],
        itemDescriptions: ["Treasury Withdrawal Q3", "Hard Fork to v11"],
      },
    ]);
    expect(map.get(PID_A)).toBe("Treasury Withdrawal Q3");
    expect(map.get(PID_B)).toBe("Hard Fork to v11");
  });

  test("first (newest) ballot wins on duplicate ids", () => {
    const map = ballotTitleMap([
      { items: [PID_A], itemDescriptions: ["Newest title"] },
      { items: [PID_A], itemDescriptions: ["Older title"] },
    ]);
    expect(map.get(PID_A)).toBe("Newest title");
  });

  test("skips empty and whitespace-only titles", () => {
    const map = ballotTitleMap([
      { items: [PID_A, PID_B], itemDescriptions: ["", "  "] },
      { items: [PID_A], itemDescriptions: ["Fallback title"] },
    ]);
    expect(map.get(PID_A)).toBe("Fallback title");
    expect(map.has(PID_B)).toBe(false);
  });

  test("tolerates undefined input and misaligned arrays", () => {
    expect(ballotTitleMap(undefined).size).toBe(0);
    const map = ballotTitleMap([
      { items: [PID_A, PID_B], itemDescriptions: ["Only one"] },
    ]);
    expect(map.get(PID_A)).toBe("Only one");
    expect(map.has(PID_B)).toBe(false);
  });
});
