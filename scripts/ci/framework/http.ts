type JsonRecord = Record<string, unknown>;

const DEFAULT_RETRY_STATUSES = new Set([408, 418, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 6;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function getRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function getRetryDelayMs(args: {
  attempt: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  retryAfterMs?: number | null;
}): number {
  if (typeof args.retryAfterMs === "number") {
    return Math.min(args.retryAfterMs, args.maxRetryDelayMs);
  }
  const exponentialDelay = args.retryDelayMs * 2 ** Math.max(0, args.attempt - 1);
  return Math.min(exponentialDelay, args.maxRetryDelayMs);
}

function findBigIntPath(value: unknown, path = "body"): string | null {
  if (typeof value === "bigint") return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = findBigIntPath(value[index], `${path}[${index}]`);
      if (childPath) return childPath;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = findBigIntPath(child, `${path}.${key}`);
      if (childPath) return childPath;
    }
  }
  return null;
}

export async function requestJson<T = unknown>(args: {
  url: string;
  method?: "GET" | "POST";
  token?: string;
  body?: JsonRecord;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  retryStatuses?: number[];
}): Promise<{ status: number; data: T }> {
  const {
    url,
    method = "GET",
    token,
    body,
    timeoutMs = 30000,
    retries = parseNonNegativeInt(process.env.CI_HTTP_RETRIES, DEFAULT_RETRIES),
    retryDelayMs = parseNonNegativeInt(process.env.CI_HTTP_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS),
    maxRetryDelayMs = parseNonNegativeInt(process.env.CI_HTTP_MAX_RETRY_DELAY_MS, DEFAULT_MAX_RETRY_DELAY_MS),
    retryStatuses,
  } = args;
  const retryableStatuses = retryStatuses ? new Set(retryStatuses) : DEFAULT_RETRY_STATUSES;
  const bigIntPath = body ? findBigIntPath(body) : null;
  if (bigIntPath) {
    throw new Error(
      `requestJson body contains non-JSON BigInt at ${bigIntPath}; convert diagnostics to strings before sending the request`,
    );
  }

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = (await response.json()) as T;
      clearTimeout(timer);
      if (attempt <= retries && retryableStatuses.has(response.status)) {
        await sleep(
          getRetryDelayMs({
            attempt,
            retryDelayMs,
            maxRetryDelayMs,
            retryAfterMs: getRetryAfterMs(response.headers.get("retry-after")),
          }),
        );
        continue;
      }
      return { status: response.status, data };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt <= retries) {
        await sleep(getRetryDelayMs({ attempt, retryDelayMs, maxRetryDelayMs }));
      }
    }
  }

  throw new Error(`HTTP request failed after ${retries + 1} attempt(s): ${String(lastError)}`);
}
