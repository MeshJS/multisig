export function getProviderErrorStatus(error: unknown): number | undefined {
  if (typeof error === "string") {
    try {
      return getProviderErrorStatus(JSON.parse(error));
    } catch {
      return undefined;
    }
  }

  if (error instanceof Error && error.message) {
    const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match?.[1]) return Number(match[1]);
    try {
      return getProviderErrorStatus(JSON.parse(error.message));
    } catch {
      // Fall through to object-shaped checks.
    }
  }

  if (!error || typeof error !== "object") {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  if (typeof record.status_code === "number") return record.status_code;

  const response = record.response;
  if (response && typeof response === "object") {
    const responseRecord = response as Record<string, unknown>;
    if (typeof responseRecord.status === "number") return responseRecord.status;
    const responseData = responseRecord.data;
    if (responseData && typeof responseData === "object") {
      const responseDataRecord = responseData as Record<string, unknown>;
      if (typeof responseDataRecord.status_code === "number") {
        return responseDataRecord.status_code;
      }
      if (typeof responseDataRecord.status === "number") {
        return responseDataRecord.status;
      }
    }
  }

  const data = record.data;
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    if (typeof dataRecord.status_code === "number") return dataRecord.status_code;
    if (typeof dataRecord.status === "number") return dataRecord.status;
  }

  return undefined;
}

export function isProviderNotFoundError(error: unknown): boolean {
  return getProviderErrorStatus(error) === 404;
}
