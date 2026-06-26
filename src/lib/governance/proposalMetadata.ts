import type { ProposalDetails, ProposalMetadata } from "@/types/governance";

export type ProposalMetadataListItem = {
  tx_hash: string;
  cert_index: number | string;
  governance_type: string;
};

export type ProposalMetadataProvider = {
  get: (path: string) => Promise<unknown>;
};

export const hasUsableJsonMetadata = (value: unknown): boolean =>
  Boolean(
    value &&
      typeof value === "object" &&
      "body" in (value as Record<string, unknown>) &&
      (value as Record<string, unknown>).body &&
      typeof (value as Record<string, unknown>).body === "object",
  );

export const getAnchorUrls = (anchorUrl: string): string[] => {
  if (!anchorUrl) return [];
  if (!anchorUrl.startsWith("ipfs://")) {
    return [anchorUrl];
  }
  const cidPath = anchorUrl.replace("ipfs://", "");
  return [
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://cloudflare-ipfs.com/ipfs/${cidPath}`,
    `https://dweb.link/ipfs/${cidPath}`,
  ];
};

export async function fetchJsonFromUrl(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function hydrateMetadataFromAnchor(
  rawMetadata: unknown,
): Promise<unknown> {
  if (
    rawMetadata &&
    typeof rawMetadata === "object" &&
    hasUsableJsonMetadata((rawMetadata as Record<string, unknown>).json_metadata)
  ) {
    return rawMetadata;
  }

  const anchorUrl =
    rawMetadata &&
    typeof rawMetadata === "object" &&
    typeof (rawMetadata as Record<string, unknown>).url === "string"
      ? ((rawMetadata as Record<string, unknown>).url as string)
      : null;
  if (!anchorUrl) {
    return rawMetadata;
  }

  for (const url of getAnchorUrls(anchorUrl)) {
    try {
      const anchorJson = await fetchJsonFromUrl(url);
      const jsonMetadata =
        anchorJson && typeof anchorJson === "object" && "body" in anchorJson
          ? anchorJson
          : { body: anchorJson };
      if (hasUsableJsonMetadata(jsonMetadata)) {
        return {
          ...(rawMetadata as Record<string, unknown>),
          json_metadata: jsonMetadata,
        };
      }
    } catch {
      // Try the next gateway or URL candidate.
    }
  }

  return rawMetadata;
}

export const createProposalMetadataFallback = (
  proposal: ProposalMetadataListItem,
  title = "Metadata could not be loaded.",
  abstract = `${proposal.tx_hash}#${proposal.cert_index}`,
): ProposalMetadata => ({
  tx_hash: proposal.tx_hash,
  cert_index: Number(proposal.cert_index),
  governance_type: proposal.governance_type,
  hash: "",
  url: "",
  bytes: "",
  json_metadata: {
    body: {
      title,
      abstract,
      motivation: "",
      rationale: "",
      references: [],
    },
    authors: [],
  },
});

export const normalizeProposalMetadata = (
  rawMetadata: unknown,
  proposal: ProposalMetadataListItem,
  fallbackTitle = "Metadata could not be loaded.",
  fallbackAbstract = `${proposal.tx_hash}#${proposal.cert_index}`,
): ProposalMetadata => {
  const metadata =
    rawMetadata && typeof rawMetadata === "object"
      ? (rawMetadata as Record<string, unknown>)
      : {};
  const jsonMetadata =
    metadata.json_metadata && typeof metadata.json_metadata === "object"
      ? (metadata.json_metadata as Record<string, unknown>)
      : {};
  const rawBody =
    jsonMetadata.body && typeof jsonMetadata.body === "object"
      ? (jsonMetadata.body as Record<string, unknown>)
      : {};
  const rawAuthors = jsonMetadata.authors;
  const authors = Array.isArray(rawAuthors)
    ? rawAuthors
        .map((author) =>
          author &&
          typeof author === "object" &&
          typeof (author as Record<string, unknown>).name === "string"
            ? { name: (author as Record<string, string>).name }
            : null,
        )
        .filter((author): author is { name: string } => Boolean(author))
    : [];
  const references = Array.isArray(rawBody.references)
    ? rawBody.references.filter(
        (ref): ref is { "@type": string; label: string; uri: string } =>
          Boolean(
            ref &&
              typeof ref === "object" &&
              typeof (ref as Record<string, unknown>).label === "string" &&
              typeof (ref as Record<string, unknown>).uri === "string" &&
              typeof (ref as Record<string, unknown>)["@type"] === "string",
          ),
      )
    : [];

  return {
    tx_hash:
      typeof metadata.tx_hash === "string" ? metadata.tx_hash : proposal.tx_hash,
    cert_index: Number.isFinite(Number(metadata.cert_index))
      ? Number(metadata.cert_index)
      : Number(proposal.cert_index),
    governance_type:
      typeof metadata.governance_type === "string"
        ? metadata.governance_type
        : proposal.governance_type,
    hash: typeof metadata.hash === "string" ? metadata.hash : "",
    url: typeof metadata.url === "string" ? metadata.url : "",
    bytes: typeof metadata.bytes === "string" ? metadata.bytes : "",
    json_metadata: {
      body: {
        title:
          typeof rawBody.title === "string" ? rawBody.title : fallbackTitle,
        abstract:
          typeof rawBody.abstract === "string"
            ? rawBody.abstract
            : fallbackAbstract,
        motivation:
          typeof rawBody.motivation === "string" ? rawBody.motivation : "",
        rationale:
          typeof rawBody.rationale === "string" ? rawBody.rationale : "",
        references,
      },
      authors,
    },
  };
};

export async function fetchProposalMetadataWithFallback({
  provider,
  proposal,
  details,
  fetchDetails,
}: {
  provider: ProposalMetadataProvider;
  proposal: ProposalMetadataListItem;
  details?: ProposalDetails | null;
  fetchDetails?: () => Promise<ProposalDetails | null>;
}): Promise<ProposalMetadata | null> {
  const txHash = proposal.tx_hash;
  const certIndex = Number(proposal.cert_index);

  try {
    const primary = await hydrateMetadataFromAnchor(
      await provider.get(`/governance/proposals/${txHash}/${certIndex}/metadata`),
    );
    return normalizeProposalMetadata(primary, proposal);
  } catch {
    // Details are only needed for the gov_action_id metadata fallback.
  }

  let detailsForFallback = details ?? null;
  if (!detailsForFallback && fetchDetails) {
    try {
      detailsForFallback = await fetchDetails();
    } catch {
      detailsForFallback = null;
    }
  }

  const govActionId =
    typeof detailsForFallback?.id === "string" && detailsForFallback.id.length > 0
      ? detailsForFallback.id
      : null;
  if (!govActionId) {
    return null;
  }

  try {
    const fallback = await hydrateMetadataFromAnchor(
      await provider.get(`/governance/proposals/${govActionId}/metadata`),
    );
    return normalizeProposalMetadata(fallback, proposal);
  } catch {
    return null;
  }
}
