export function extractJsonLdValue(value: any, fallback: string = "N/A"): string {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "@value" in value) return value["@value"];
  return fallback;
}