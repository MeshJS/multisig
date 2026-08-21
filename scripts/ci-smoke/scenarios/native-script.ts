import type { Context, ScenarioResult } from "./types";

export async function nativeScriptScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const walletId = ctx.wallets.legacy.id;
    const base = ctx.baseUrl.replace(/\/$/, "");
    const res = await fetch(
      `${base}/api/v1/nativeScript?walletId=${encodeURIComponent(walletId)}`,
      { headers: { Authorization: `Bearer ${ctx.botToken}` } },
    );

    if (!res.ok) {
      return {
        name: "native-script",
        passed: false,
        critical: false,
        message: `nativeScript returned ${res.status}: ${await res.text()}`,
        durationMs: Date.now() - start,
      };
    }

    const data = (await res.json()) as { scriptCbor?: string; address?: string };
    if (!data.scriptCbor || typeof data.scriptCbor !== "string") {
      return {
        name: "native-script",
        passed: false,
        critical: false,
        message: "nativeScript response missing scriptCbor",
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "native-script",
      passed: true,
      critical: false,
      message: `Script CBOR length: ${data.scriptCbor.length}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "native-script",
      passed: false,
      critical: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
