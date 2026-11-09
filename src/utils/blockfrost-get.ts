import { getBlockfrostProjectId } from "@/utils/blockfrost-key";

/**
 * A minimal Blockfrost reader: `get(path)` and nothing else.
 *
 * Public pages that only read (the DRep explorer, governance stats, the token
 * flow demo) used Mesh's BlockfrostProvider for this, and its import pulls the
 * whole Cardano serialization stack (~1.7 MB gzipped) into the page. This does
 * the same GET with fetch.
 *
 * Behaviour matches BlockfrostProvider.get: resolves with the JSON body on 200
 * or 202, and otherwise rejects with the same JSON string Mesh throws —
 * `{"data":…,"headers":…,"status":…}` — so existing error handling is unchanged.
 */
export interface BlockfrostReader {
  get<T = any>(path: string): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function getBlockfrostReader(network: number): BlockfrostReader {
  const projectId = getBlockfrostProjectId(network);
  // Same derivation as Mesh: the key's prefix names its network.
  const base = `https://cardano-${projectId.slice(0, 7)}.blockfrost.io/api/v0`;

  return {
    async get(path) {
      const url = `${base}/${path.replace(/^\/+/, "")}`;
      let response: Response;
      try {
        response = await fetch(url, { headers: { project_id: projectId } });
      } catch (error) {
        throw JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Non-JSON body: keep the text.
      }
      if (response.status === 200 || response.status === 202) {
        return data as never;
      }
      throw JSON.stringify({
        data,
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
      });
    },
  };
}
