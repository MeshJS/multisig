import { baseToDisplay, displayToBase } from "@/lib/tx-draft/decimal";

describe("displayToBase", () => {
  test("scales by decimals with exact string math", () => {
    expect(displayToBase("1.5", 6)).toBe("1500000");
    expect(displayToBase("0.000001", 6)).toBe("1");
    expect(displayToBase("12", 6)).toBe("12000000");
    expect(displayToBase("1.123456", 6)).toBe("1123456");
    expect(displayToBase("7", 0)).toBe("7");
    expect(displayToBase(".5", 6)).toBe("500000");
  });

  test("truncates precision beyond the asset's decimals", () => {
    expect(displayToBase("1.9999999", 6)).toBe("1999999");
    expect(displayToBase("1.9", 0)).toBe("1");
  });

  test("rejects invalid input", () => {
    expect(displayToBase("", 6)).toBeUndefined();
    expect(displayToBase(".", 6)).toBeUndefined();
    expect(displayToBase("abc", 6)).toBeUndefined();
    expect(displayToBase("1,5", 6)).toBeUndefined();
    expect(displayToBase("-1", 6)).toBeUndefined();
  });
});

describe("baseToDisplay", () => {
  test("renders base units at the asset's precision", () => {
    expect(baseToDisplay("1500000", 6)).toBe("1.5");
    expect(baseToDisplay("1", 6)).toBe("0.000001");
    expect(baseToDisplay("12000000", 6)).toBe("12");
    expect(baseToDisplay("7", 0)).toBe("7");
    expect(baseToDisplay("-1500000", 6)).toBe("-1.5");
    expect(baseToDisplay("garbage", 6)).toBe("");
  });

  test("round-trips with displayToBase", () => {
    for (const value of ["1.5", "0.000001", "123.456789", "42"]) {
      expect(baseToDisplay(displayToBase(value, 6)!, 6)).toBe(value);
    }
  });
});
