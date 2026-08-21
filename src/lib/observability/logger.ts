/**
 * Structured logger.
 *
 * - Production: emits one JSON line per call to stdout/stderr.
 * - Development: emits a single human-readable line.
 *
 * Built on console; no extra deps. Never logs raw tokens, signatures, or
 * cookies — callers should pre-redact.
 */

const isProd = process.env.NODE_ENV === "production";

const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "jwt",
  "token",
  "secret",
  "apiKey",
  "api_key",
]);

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const safeCtx = ctx ? (redact(ctx) as Record<string, unknown>) : undefined;
  if (isProd) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(safeCtx ? { ctx: safeCtx } : {}),
    });
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
    return;
  }
  // Dev: pretty
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (safeCtx) {
    fn(`[${level}] ${msg}`, safeCtx);
  } else {
    fn(`[${level}] ${msg}`);
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
