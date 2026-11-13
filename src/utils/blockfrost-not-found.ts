/**
 * Whether a Blockfrost read failed with 404.
 *
 * Mesh's `BlockfrostProvider.get` — and the light reader
 * (`src/utils/blockfrost-get.ts`), which copies it — rejects with a JSON
 * *string*: `{"data":{"status_code":404,…},"headers":…,"status":404}`, not an
 * Error. Checking `err.status` or `err instanceof Error` never matches that
 * string, so a "never seen on chain" answer was read as a lookup failure.
 * Other code paths reject with an object, so both shapes are accepted.
 */
export function isBlockfrostNotFound(error: unknown): boolean {
  let value: unknown = error;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  const e = value as {
    status?: unknown;
    response?: { status?: unknown };
    data?: { status_code?: unknown };
  };
  return (
    e.status === 404 ||
    e.response?.status === 404 ||
    e.data?.status_code === 404
  );
}
