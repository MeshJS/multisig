export type ProposalMetadata = {
  bytes: string;
  cert_index: number;
  hash: string;
  json_metadata: {
    body: {
      title: string;
      abstract: string;
      motivation: string;
      rationale: string;
    };
    authors: {
      name: string;
    }[];
  };
  tx_hash: string;
  url: string;
  governance_type: string;
};
