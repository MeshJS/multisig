import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  createProposalMetadataFallback,
  fetchProposalMetadataWithFallback,
  getAnchorUrls,
  normalizeProposalMetadata,
} from "@/lib/governance/proposalMetadata";

const proposal = {
  tx_hash: "tx-proposal",
  cert_index: 0,
  governance_type: "info_action",
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("proposal metadata helpers", () => {
  it("normalizes usable Blockfrost metadata without extra fetching", async () => {
    const provider = {
      get: jest.fn(async () => ({
        tx_hash: "tx-proposal",
        cert_index: 0,
        hash: "hash",
        url: "https://example.com/metadata.json",
        bytes: "123",
        json_metadata: {
          body: {
            title: "Proposal title",
            abstract: "Proposal abstract",
            motivation: "Motivation",
            rationale: "Rationale",
            references: [{ "@type": "Other", label: "Spec", uri: "https://example.com" }],
          },
          authors: [{ name: "Ada" }],
        },
      })),
    };

    const metadata = await fetchProposalMetadataWithFallback({ provider, proposal });

    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(metadata).toMatchObject({
      tx_hash: "tx-proposal",
      cert_index: 0,
      governance_type: "info_action",
      hash: "hash",
      json_metadata: {
        body: {
          title: "Proposal title",
          abstract: "Proposal abstract",
          motivation: "Motivation",
          rationale: "Rationale",
        },
        authors: [{ name: "Ada" }],
      },
    });
  });

  it("hydrates metadata from a regular anchor URL", async () => {
    const provider = {
      get: jest.fn(async () => ({
        tx_hash: "tx-proposal",
        cert_index: 0,
        url: "https://example.com/anchor.json",
      })),
    };
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          body: {
            title: "Anchor title",
            abstract: "Anchor abstract",
          },
          authors: [{ name: "Anchor author" }],
        }),
        { status: 200 },
      ),
    );

    const metadata = await fetchProposalMetadataWithFallback({ provider, proposal });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/anchor.json",
      expect.objectContaining({ method: "GET" }),
    );
    expect(metadata?.json_metadata.body.title).toBe("Anchor title");
    expect(metadata?.json_metadata.authors).toEqual([{ name: "Anchor author" }]);
  });

  it("tries IPFS gateway fallbacks until one returns usable JSON", async () => {
    expect(getAnchorUrls("ipfs://cid/path.json")).toEqual([
      "https://ipfs.io/ipfs/cid/path.json",
      "https://cloudflare-ipfs.com/ipfs/cid/path.json",
      "https://dweb.link/ipfs/cid/path.json",
    ]);

    const provider = {
      get: jest.fn(async () => ({
        tx_hash: "tx-proposal",
        cert_index: 0,
        url: "ipfs://cid/path.json",
      })),
    };
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 504 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Wrapped anchor title" }), {
          status: 200,
        }),
      );

    const metadata = await fetchProposalMetadataWithFallback({ provider, proposal });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(metadata?.json_metadata.body.title).toBe("Wrapped anchor title");
  });

  it("returns fallback metadata without changing the ProposalMetadata shape", () => {
    const metadata = createProposalMetadataFallback(proposal);

    expect(metadata).toEqual({
      tx_hash: "tx-proposal",
      cert_index: 0,
      governance_type: "info_action",
      hash: "",
      url: "",
      bytes: "",
      json_metadata: {
        body: {
          title: "Metadata could not be loaded.",
          abstract: "tx-proposal#0",
          motivation: "",
          rationale: "",
          references: [],
        },
        authors: [],
      },
    });
  });

  it("normalizes missing or unusable metadata fields into safe defaults", () => {
    const metadata = normalizeProposalMetadata({ json_metadata: { body: null } }, proposal);

    expect(metadata).toMatchObject({
      tx_hash: "tx-proposal",
      cert_index: 0,
      governance_type: "info_action",
      json_metadata: {
        body: {
          title: "Metadata could not be loaded.",
          abstract: "tx-proposal#0",
          motivation: "",
          rationale: "",
          references: [],
        },
        authors: [],
      },
    });
  });
});
