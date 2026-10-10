import { describe, expect, it } from "@jest/globals";

import {
  PORT_SPACING,
  isValuePortIn,
  isValuePortOut,
  portStackHeight,
  portTopPercent,
  protoPort,
  valuePortIn,
  valuePortOut,
} from "@/components/common/token-flow/handles";

describe("value port ids", () => {
  it("generates indexed in/out handle ids", () => {
    expect(valuePortIn(0)).toBe("in-0");
    expect(valuePortIn(12)).toBe("in-12");
    expect(valuePortOut(0)).toBe("out-0");
    expect(valuePortOut(3)).toBe("out-3");
    expect(protoPort(0)).toBe("proto-0");
    expect(protoPort(2)).toBe("proto-2");
  });

  it("recognizes exactly its own id shapes", () => {
    expect(isValuePortIn(valuePortIn(4))).toBe(true);
    expect(isValuePortOut(valuePortOut(4))).toBe(true);

    // React Flow hands us arbitrary handle ids — everything else must be
    // rejected, including cross-direction ids and the fixed protocol handles.
    expect(isValuePortIn(valuePortOut(4))).toBe(false);
    expect(isValuePortOut(valuePortIn(4))).toBe(false);
    expect(isValuePortIn(protoPort(0))).toBe(false);
    expect(isValuePortIn("in-")).toBe(false);
    expect(isValuePortIn("in-1x")).toBe(false);
    expect(isValuePortIn(null)).toBe(false);
    expect(isValuePortIn(undefined)).toBe(false);
    expect(isValuePortOut("")).toBe(false);
  });
});

describe("port geometry", () => {
  it("distributes ports evenly over the card height", () => {
    expect(portTopPercent(0, 1)).toBe(50);
    expect(portTopPercent(0, 3)).toBe(25);
    expect(portTopPercent(1, 3)).toBe(50);
    expect(portTopPercent(2, 3)).toBe(75);
  });

  it("grows the card so consecutive ports stay PORT_SPACING apart", () => {
    expect(portStackHeight(1)).toBe(2 * PORT_SPACING);
    expect(portStackHeight(3)).toBe(4 * PORT_SPACING);

    // The guarantee the layout relies on: with the computed height, the
    // vertical gap between adjacent ports is exactly PORT_SPACING.
    const count = 5;
    const height = portStackHeight(count);
    const gap =
      ((portTopPercent(1, count) - portTopPercent(0, count)) / 100) * height;
    expect(gap).toBeCloseTo(PORT_SPACING);
  });
});
