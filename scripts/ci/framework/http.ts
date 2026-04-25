type JsonRecord = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestJson<T = unknown>(args: {
  url: string;
  method?: "GET" | "POST";
  token?: string;
  body?: JsonRecord;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ status: number; data: T }> {
  const {
    url,
    method = "GET",
    token,
    body,
    timeoutMs = 30000,
    retries = 0,
  } = args;

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
      return { status: response.status, data };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt <= retries) {
        await sleep(250 * attempt);
      }
    }
  }

  throw new Error(`HTTP request failed after ${retries + 1} attempt(s): ${String(lastError)}`);
}
