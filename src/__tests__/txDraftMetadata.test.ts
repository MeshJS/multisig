import {
  applyMetadataMessage,
  chunkMetadataMessage,
} from "@/lib/tx-draft/metadata";

function recordingBuilder() {
  const calls: { label: unknown; metadata: unknown }[] = [];
  return {
    calls,
    metadataValue(label: unknown, metadata: unknown) {
      calls.push({ label, metadata });
      return this;
    },
  };
}

describe("chunkMetadataMessage", () => {
  test("short messages stay a single string", () => {
    expect(chunkMetadataMessage("hello")).toBe("hello");
    expect(chunkMetadataMessage("x".repeat(63))).toBe("x".repeat(63));
  });

  test("long messages split into 63-character chunks", () => {
    const message = "a".repeat(63) + "b".repeat(63) + "c";
    expect(chunkMetadataMessage(message)).toEqual([
      "a".repeat(63),
      "b".repeat(63),
      "c",
    ]);
  });
});

describe("applyMetadataMessage", () => {
  test("writes { msg } under the label", () => {
    const builder = recordingBuilder();
    applyMetadataMessage(builder, "674", "Payroll July");
    expect(builder.calls).toEqual([
      { label: "674", metadata: { msg: "Payroll July" } },
    ]);
  });

  test("chunks messages over 63 characters", () => {
    const builder = recordingBuilder();
    applyMetadataMessage(builder, "674", "m".repeat(64));
    expect(builder.calls[0]!.metadata).toEqual({
      msg: ["m".repeat(63), "m"],
    });
  });

  test("leaves the builder untouched for empty or missing messages", () => {
    const builder = recordingBuilder();
    applyMetadataMessage(builder, "674", undefined);
    applyMetadataMessage(builder, "674", "");
    expect(builder.calls).toEqual([]);
  });
});
