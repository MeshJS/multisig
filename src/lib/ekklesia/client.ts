/**
 * Thin client for the Ekklesia / Intersect Hydra voting API, routed through the
 * server proxy at `/api/ekklesia/*` (CORS blocks browser-direct calls).
 *
 * Auth lives under `/v0`, ballots & votes under `/v1`.
 * See src/lib/ekklesia/SPEC.md for the full reverse-engineered spec.
 */
import type {
  EkklesiaBallot,
  EkklesiaDraftRequest,
  EkklesiaDraftResponse,
  EkklesiaPackage,
  EkklesiaSessionChallenge,
  EkklesiaSignType,
  EkklesiaWitness,
} from "./types";

const PROXY_BASE = "/api/ekklesia";

/**
 * Encode the merkleRoot string as the hex of its ASCII bytes — this is the
 * `dataHex` passed to `signData` (sign the merkleRoot *string*, not its bytes).
 * Mirrors Ekklesia's own `toDataHex` helper.
 */
export function merkleRootToDataHex(merkleRoot: string): string {
  if (typeof merkleRoot !== "string") {
    throw new Error("merkleRoot must be a string");
  }
  let hex = "";
  for (let i = 0; i < merkleRoot.length; i++) {
    hex += merkleRoot.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/** Resolve a packageId from a draft response or package object. */
export function getPackageId(
  pkg: Pick<EkklesiaDraftResponse, "id" | "_id" | "package">,
): string | undefined {
  return pkg.package?.id ?? pkg.package?._id ?? pkg.id ?? pkg._id;
}

async function call<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  if (token) h.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...rest,
    headers: h,
    credentials: "include",
  });

  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body as { message?: string; error?: string })?.message ??
      (body as { error?: string })?.error ??
      `Ekklesia request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/* ----------------------------- Ballots / read ----------------------------- */

export async function fetchBallot(ballotId: string): Promise<EkklesiaBallot> {
  const res = await call<{ data: EkklesiaBallot }>(`/v1/ballots/${ballotId}`);
  return res.data;
}

export async function fetchMyVotes(
  ballotId: string,
  token?: string,
): Promise<unknown> {
  return call(`/v1/votes/${ballotId}/mine`, { token });
}

export async function fetchPackages(
  ballotId: string,
  token?: string,
  opts: { includeTerminal?: boolean; limit?: number } = {},
): Promise<EkklesiaPackage[]> {
  const qs = new URLSearchParams();
  if (opts.includeTerminal) qs.set("includeTerminal", "true");
  if (opts.limit) qs.set("limit", String(opts.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await call<{ data?: EkklesiaPackage[] }>(
    `/v1/votes/${ballotId}/packages${suffix}`,
    { token },
  );
  return res.data ?? [];
}

/* --------------------------------- Auth ---------------------------------- */

/** Step 1: request a nonce challenge to sign. */
export async function requestSession(
  signerAddress: string,
  signType: EkklesiaSignType,
): Promise<EkklesiaSessionChallenge> {
  return call<EkklesiaSessionChallenge>(`/v0/session`, {
    method: "POST",
    body: JSON.stringify({ signerAddress, signType }),
  });
}

/** Step 2: submit the signed nonce; returns the session (JWT via cookie/body). */
export async function submitSession(
  signerAddress: string,
  signType: EkklesiaSignType,
  witness: EkklesiaWitness,
): Promise<{ token?: string; [key: string]: unknown }> {
  return call(`/v0/session`, {
    method: "PUT",
    body: JSON.stringify({ signerAddress, signType, ...witness }),
  });
}

/* --------------------------------- Vote ---------------------------------- */

/** Create a vote draft/package. Returns the shared `merkleRoot` + packageId. */
export async function draftVote(
  ballotId: string,
  body: EkklesiaDraftRequest,
  token?: string,
): Promise<EkklesiaDraftResponse> {
  return call<EkklesiaDraftResponse>(`/v1/votes/${ballotId}/draft`, {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

/** Attach a signer's witness to an existing package (one per cosigner). */
export async function submitSignature(
  ballotId: string,
  packageId: string,
  witness: EkklesiaWitness,
  token?: string,
): Promise<{ status?: string; error?: string; [key: string]: unknown }> {
  return call(`/v1/votes/${ballotId}/signature`, {
    method: "POST",
    body: JSON.stringify({ packageId, witness }),
    token,
  });
}

/** Submit/finalize a package once the script threshold of witnesses is met. */
export async function submitPackage(
  ballotId: string,
  packageId: string,
  token?: string,
): Promise<{ status?: string; error?: string; [key: string]: unknown }> {
  return call(`/v1/votes/${ballotId}/submit`, {
    method: "POST",
    body: JSON.stringify({ packageId }),
    token,
  });
}

/** Cancel a draft package and release its nonce. */
export async function cancelPackage(
  ballotId: string,
  packageId: string,
  token?: string,
): Promise<unknown> {
  return call(`/v1/votes/${ballotId}/package/${packageId}`, {
    method: "DELETE",
    token,
  });
}
