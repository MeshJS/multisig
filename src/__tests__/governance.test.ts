import { describe, expect, it } from "@jest/globals";
import { getProposalStatus } from "../lib/governance";
import type { ProposalDetails } from "../types/governance";

describe("getProposalStatus", () => {
  const baseProposal: ProposalDetails = {
    id: "proposal",
    tx_hash: "tx-hash",
    cert_index: 0,
    governance_type: "info_action",
    deposit: "0",
    return_address: "addr_test1...",
    expiration: null,
    governance_description: { tag: "off_chain" },
    ratified_epoch: null,
    enacted_epoch: null,
    dropped_epoch: null,
    expired_epoch: null,
  };

  it("returns active when all terminal epochs are null", () => {
    expect(getProposalStatus({ ...baseProposal, id: "proposal-1" })).toBe("active");
  });

  it("returns active when terminal epoch fields are undefined", () => {
    expect(
      getProposalStatus({
        ...baseProposal,
        id: "proposal-2",
        ratified_epoch: undefined as unknown as number | null,
        enacted_epoch: undefined as unknown as number | null,
        dropped_epoch: undefined as unknown as number | null,
        expired_epoch: undefined as unknown as number | null,
      } as unknown as ProposalDetails),
    ).toBe("active");
  });
});
