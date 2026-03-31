function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("authorization") ||
    k.includes("api_key") ||
    k.includes("apikey")
  );
}

export function redactForLogs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForLogs(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(obj)) {
    out[key] = shouldRedactKey(key) ? "[REDACTED]" : redactForLogs(fieldValue);
  }
  return out;
}

export function stringifyRedacted(value: unknown): string {
  try {
    return JSON.stringify(redactForLogs(value));
  } catch {
    return String(value);
  }
}
