function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase();
  const sensitiveKeyParts = [
    "token",
    "secret",
    "authorization",
    "api_key",
    "apikey",
    "mnemonic",
    "privatekey",
    "private_key",
    "signingkey",
    "signing_key",
    "seed",
    "xprv",
    "ed25519e_sk",
  ];

  if (sensitiveKeyParts.some((part) => k.includes(part))) {
    return true;
  }

  return (
    (k.includes("private") && k.includes("key")) ||
    (k.includes("signing") && k.includes("key"))
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
