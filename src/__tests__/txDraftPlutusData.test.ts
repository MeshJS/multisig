import { validatePlutusData } from "@/lib/tx-draft/plutus-data";

function json(value: unknown) {
  return validatePlutusData({ format: "JSON", text: JSON.stringify(value) });
}

describe("shared Plutus data adapter (real Mesh codecs)", () => {
  test.each([
    [{ int: 0 }, "00"],
    [{ int: -2 }, "21"],
    [{ bytes: "aabb" }, "42aabb"],
    [{ list: [] }, "80"],
    [{ constructor: 0, fields: [] }, "d87980"],
    [{ map: [] }, "a0"],
  ])("encodes %j using the SDK", (value, cbor) => {
    expect(json(value)).toMatchObject({ valid: true, cbor });
  });

  test("nested constructors, lists and maps survive JSON/CBOR/JSON", () => {
    const value = {
      constructor: 1,
      fields: [
        { list: [{ int: "-9007199254740993" }, { bytes: "" }] },
        { map: [{ k: { bytes: "01" }, v: { int: "9007199254740993" } }] },
      ],
    };
    const encoded = json(value);
    expect(encoded.valid).toBe(true);
    if (!encoded.valid) throw new Error(encoded.error);
    const decoded = validatePlutusData({ format: "CBOR", text: encoded.cbor });
    expect(decoded).toEqual(encoded);
    if (!decoded.valid) throw new Error(decoded.error);
    expect(JSON.parse(decoded.json)).toEqual({ ...value, constructor: "1" });
    expect(validatePlutusData({ format: "JSON", text: decoded.json })).toEqual(
      encoded,
    );
  });

  test("CBOR preserves integers beyond JS safe range exactly", () => {
    const result = validatePlutusData({
      format: "CBOR",
      text: " 1B0020000000000001 ",
    });
    expect(result).toMatchObject({ valid: true, cbor: "1b0020000000000001" });
    if (!result.valid) throw new Error(result.error);
    expect(JSON.parse(result.json)).toEqual({ int: "9007199254740993" });
    expect(json({ int: "9007199254740993" })).toEqual(result);
    expect(json({ int: "1267650600228229401496703205376" }).valid).toBe(true);
  });

  test.each([
    "",
    "0",
    "zz",
    "0x01",
    "a1",
    "0102",
    "d8798001",
    "f5",
    "f6",
    "61ff",
    "81",
  ])("rejects malformed/non-Plutus or extra CBOR: %s", (text) => {
    expect(validatePlutusData({ format: "CBOR", text }).valid).toBe(false);
  });

  test.each([
    "{",
    "null",
    "[]",
    "true",
    '"hello"',
    '{"arbitrary":1}',
    '{"int":1,"bytes":"01"}',
    '{"bytes":"f"}',
    '{"bytes":"gg"}',
    '{"constructor":-1,"fields":[]}',
    '{"constructor":0}',
    '{"list":[{"int":1.5}]}',
    '{"map":[{"k":{"int":1}}]}',
    '{"int":9007199254740993}',
    '{"int":-9007199254740993}',
    '{"int":9007199254740991.1}',
    '{"int":1.00000000000000001}',
    '{"int":1e100}',
    '{"int":"1.1"}',
    '{"int":"1e9"}',
    '{"int":"+1"}',
    '{"int":"01"}',
  ])("rejects invalid or lossy JSON: %s", (text) => {
    expect(validatePlutusData({ format: "JSON", text }).valid).toBe(false);
  });

  test("safe numbers and quoted integers work; hex strings are not scanned as numbers", () => {
    expect(json({ int: Number.MAX_SAFE_INTEGER }).valid).toBe(true);
    expect(json({ bytes: "900719925474099312" }).valid).toBe(true);
    expect(json({ constructor: "128", fields: [] }).valid).toBe(true);
  });

  test("invalid edits return no previous encoded data", () => {
    expect(validatePlutusData({ format: "CBOR", text: "01" }).valid).toBe(true);
    const invalid = validatePlutusData({ format: "CBOR", text: "0" });
    expect(invalid).toMatchObject({ valid: false, error: expect.any(String) });
    expect(invalid).not.toHaveProperty("cbor");
    expect(invalid).not.toHaveProperty("json");
  });

  test.each([
    undefined,
    null,
    { format: "Mesh", text: "1" },
    { format: "CBOR", text: 1 },
  ])("rejects invalid entry shape %j", (entry) => {
    expect(validatePlutusData(entry).valid).toBe(false);
  });
});
