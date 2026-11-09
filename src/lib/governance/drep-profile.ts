import type {
  BlockfrostDrepInfo,
  BlockfrostDrepMetadata,
} from "@/types/governance";

/** Anything with Blockfrost's raw `get(path)`: the light reader or Mesh's provider. */
type DrepReader = {
  get: (path: string) => Promise<unknown>;
};

export type DrepProfile = {
  /** Null when Blockfrost has no record of this DRep (404). */
  details: BlockfrostDrepInfo | null;
  /** Null when the DRep published no metadata, or it could not be read. */
  metadata: BlockfrostDrepMetadata | null;
};

/**
 * One DRep's on-chain record and its metadata, for the public DRep explorer.
 *
 * The two reads are independent, so they go out together: awaiting them in
 * turn doubled the time to first paint of the detail page and, on the list
 * page, held every row's name and avatar back by a second round-trip.
 *
 * Missing metadata is normal — many DReps never publish any — and Blockfrost
 * answers it with a 404, so that case is silent. Any other metadata failure
 * still leaves the record usable and is only warned about. A failure reading
 * the record itself is rethrown (except 404, which is "no such DRep"), because
 * without it the caller has nothing to show.
 */
const DREP_ID = /^[A-Za-z0-9_]{1,128}$/;

export async function fetchDrepProfile(
  reader: DrepReader,
  drepId: string,
): Promise<DrepProfile> {
  // The id comes from the URL. DRep ids are bech32 (`drep1…`, `drep_script1…`)
  // or hex, so anything else — `..` included, which encoding would not stop —
  // cannot name a DRep and is answered without a request.
  const id = drepId.trim();
  if (!DREP_ID.test(id)) return { details: null, metadata: null };
  const [details, metadata] = await Promise.allSettled([
    reader.get(`/governance/dreps/${id}`),
    reader.get(`/governance/dreps/${id}/metadata/`),
  ]);

  if (details.status === "rejected" && !isBlockfrostNotFound(details.reason)) {
    throw details.reason;
  }
  if (
    metadata.status === "rejected" &&
    !isBlockfrostNotFound(metadata.reason)
  ) {
    console.warn("Could not read metadata for DRep %s:", drepId, metadata.reason);
  }

  return {
    details:
      details.status === "fulfilled"
        ? ((details.value as BlockfrostDrepInfo | null) ?? null)
        : null,
    metadata:
      metadata.status === "fulfilled"
        ? ((metadata.value as BlockfrostDrepMetadata | null) ?? null)
        : null,
  };
}

/**
 * Whether a Blockfrost read failed with 404.
 *
 * The light reader (`src/utils/blockfrost-get.ts`) rejects with a JSON
 * *string* — `{"data":…,"status":404}` — copying Mesh's BlockfrostProvider,
 * while other code paths reject with an object. Checking only
 * `err.response.status` (what the explorer pages did) never matches the
 * string, so every DRep without metadata was logged as an error.
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
