import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// zustand answers server renders from the store's initial state, so the
// runtime state is supplied through a stand-in hook instead.
let mockRuntime = { requested: false, active: false };
jest.mock("@/lib/wallet-runtime", () => ({
  useWalletRuntime: <T,>(select: (s: typeof mockRuntime) => T) => select(mockRuntime),
}));

// Stand in for the lazily loaded generator, so the test sees which branch the
// slot renders without loading the Cardano stack (or webpack's chunking).
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function TokenGeneratorStub() {
      return createElement("div", { id: "token-generator" });
    },
}));

// The generator's wallet bridge, so its own branches can be rendered here.
let mockWallet: { wallet: unknown; connected: boolean } = { wallet: null, connected: false };
jest.mock("@/hooks/useMeshWallet", () => ({
  __esModule: true,
  default: () => mockWallet,
}));

import TokenGeneratorSlot from "@/components/pages/api-docs/token-generator-slot";
import TokenGenerator from "@/components/pages/api-docs/token-generator";

/**
 * /api-docs is read by developers and agents far more often than anyone
 * generates a token on it. It is a light route: the API reference renders with
 * no Cardano code, and only the token generator — the one part that signs with
 * a wallet — loads the stack, and only once the wallet runtime is up.
 */
describe("/api-docs token generator slot", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(TokenGeneratorSlot, { swaggerSystemRef: { current: null } }),
    );

  beforeEach(() => {
    mockRuntime = { requested: false, active: false };
  });

  it("shows the connect hint, not the generator, while the wallet runtime is not loaded", () => {
    const html = render();
    expect(html).toContain("Connect wallet to generate token");
    expect(html).not.toContain(`id="token-generator"`);
  });

  it("keeps showing the hint while the runtime is only requested, not yet active", () => {
    mockRuntime = { requested: true, active: false };
    expect(render()).toContain("Connect wallet to generate token");
  });

  it("mounts the generator once the wallet runtime is active", () => {
    mockRuntime = { requested: true, active: true };
    const html = render();
    expect(html).toContain('id="token-generator"');
    expect(html).not.toContain("Connect wallet to generate token");
  });
});

describe("/api-docs token generator", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(TokenGenerator, { swaggerSystemRef: { current: null } }),
    );

  it("shows the same connect hint while the runtime is up but no wallet is connected", () => {
    mockWallet = { wallet: null, connected: false };
    const html = render();
    expect(html).toContain("Connect wallet to generate token");
    expect(html).not.toContain("Generate Token");
  });

  it("offers Generate Token once a wallet is connected", () => {
    mockWallet = { wallet: {}, connected: true };
    const html = render();
    expect(html).toContain("Generate Token");
    expect(html).not.toContain("Connect wallet to generate token");
  });
});

/**
 * The bundle budget catches this after a full build; this catches it in the
 * unit run. Follows the page's static (non-type, non-`import()`) imports
 * through src/ and fails if any of them reaches the wallet stack.
 */
describe("/api-docs static import graph", () => {
  const SRC = path.resolve(__dirname, "..");
  const WALLET_STACK = [/^@meshsdk\//, /^@\/hooks\/useMeshWallet$/];

  function resolveLocal(spec: string, from: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function staticImports(file: string): string[] {
    const source = fs.readFileSync(file, "utf8");
    const specs: string[] = [];
    // `import x from "y"`, `import "y"`, `export … from "y"` — but not
    // `import type …` / `export type …`, which are erased at compile time.
    const re = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
    for (const match of source.matchAll(re)) specs.push(match[1]!);
    return specs;
  }

  it("never statically imports the Cardano wallet stack", () => {
    const entry = path.join(SRC, "pages", "api-docs.tsx");
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of staticImports(file)) {
        if (WALLET_STACK.some((re) => re.test(spec))) {
          offenders.push(`${path.relative(SRC, file)} → ${spec}`);
          continue;
        }
        const local = resolveLocal(spec, file);
        if (local && /\.tsx?$/.test(local)) queue.push(local);
      }
    }
    // Sanity: the walk actually reached the slot.
    expect([...seen].some((f) => f.endsWith("token-generator-slot.tsx"))).toBe(true);
    expect(offenders).toEqual([]);
  });

  it("would catch the generator itself if it were imported statically", () => {
    // Guards the guard: the generator does import the wallet bridge.
    const generator = path.join(SRC, "components", "pages", "api-docs", "token-generator.tsx");
    expect(staticImports(generator)).toContain("@/hooks/useMeshWallet");
  });
});
