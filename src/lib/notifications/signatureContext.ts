export type SignatureContextDetail = {
  label: string;
  value: string;
};

export type SignatureContext = {
  summary: string;
  details?: SignatureContextDetail[];
};

type TxOutputAmount = {
  unit?: unknown;
  quantity?: unknown;
};

type TxOutput = {
  address?: unknown;
  amount?: unknown;
};

type ProxyVote = {
  proposalId?: unknown;
  voteKind?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return asRecord(value);
}

export function maskAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function formatQuantity(unit: string, quantity: string): string {
  if (unit === "lovelace") {
    try {
      const lovelace = BigInt(quantity);
      const whole = lovelace / 1_000_000n;
      const fraction = lovelace % 1_000_000n;
      const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/, "");
      return `${fractionText ? `${whole.toString()}.${fractionText}` : whole.toString()} ADA`;
    } catch {
      return `${quantity} lovelace`;
    }
  }

  return `${quantity} ${maskAssetUnit(unit)}`;
}

function maskAssetUnit(unit: string): string {
  return unit.length > 18 ? `${unit.slice(0, 10)}...${unit.slice(-6)}` : unit;
}

function firstAmount(amount: unknown): { unit: string; quantity: string } | null {
  if (!Array.isArray(amount)) return null;

  for (const item of amount as TxOutputAmount[]) {
    if (
      typeof item?.unit === "string" &&
      typeof item.quantity === "string" &&
      item.quantity.trim().length > 0
    ) {
      return { unit: item.unit, quantity: item.quantity };
    }
  }

  return null;
}

function summarizeOutputs(outputs: unknown): SignatureContext | null {
  if (!Array.isArray(outputs) || outputs.length === 0) return null;

  const output = (outputs as TxOutput[]).find(
    (candidate) =>
      typeof candidate?.address === "string" && firstAmount(candidate.amount),
  );
  if (!output || typeof output.address !== "string") return null;

  const amount = firstAmount(output.amount);
  if (!amount) return null;

  const outputCount = outputs.length;
  return {
    summary: `Send ${formatQuantity(amount.unit, amount.quantity)} to ${maskAddress(output.address)}`,
    details:
      outputCount > 1
        ? [{ label: "Outputs", value: `${outputCount} total outputs` }]
        : undefined,
  };
}

function summarizeProxyBot(proxyBot: Record<string, unknown>): SignatureContext | null {
  const kind = proxyBot.kind;

  if (kind === "proxyVote" && Array.isArray(proxyBot.votes)) {
    const vote = (proxyBot.votes as ProxyVote[]).find(
      (candidate) =>
        typeof candidate?.proposalId === "string" ||
        typeof candidate?.voteKind === "string",
    );
    const voteCount = proxyBot.votes.length;
    const choice = typeof vote?.voteKind === "string" ? vote.voteKind : "vote";
    const proposal =
      typeof vote?.proposalId === "string" ? maskAddress(vote.proposalId) : null;

    return {
      summary: `Governance ${choice} vote${proposal ? ` on ${proposal}` : ""}`,
      details:
        voteCount > 1 ? [{ label: "Votes", value: `${voteCount} proposals` }] : undefined,
    };
  }

  if (kind === "proxyDRepCertificate") {
    const action =
      typeof proxyBot.action === "string" && proxyBot.action.trim()
        ? proxyBot.action.trim()
        : "update";
    const dRepId =
      typeof proxyBot.dRepId === "string" && proxyBot.dRepId.trim()
        ? maskAddress(proxyBot.dRepId)
        : null;

    return {
      summary: `Governance DRep ${action}${dRepId ? ` for ${dRepId}` : ""}`,
    };
  }

  return null;
}

export function summarizeTransactionSignatureContext(
  txJson: unknown,
  description?: string | null,
): SignatureContext | null {
  const parsed = parseJsonRecord(txJson);
  if (parsed) {
    const proxyBot = asRecord(parsed.proxyBot);
    if (proxyBot) {
      const proxySummary = summarizeProxyBot(proxyBot);
      if (proxySummary) return proxySummary;
    }

    const outputSummary = summarizeOutputs(parsed.outputs);
    if (outputSummary) return outputSummary;
  }

  return summarizeDescriptionSignatureContext(description);
}

export function summarizeSignableSignatureContext(args: {
  method?: string | null;
  description?: string | null;
}): SignatureContext | null {
  const method = args.method?.trim();
  const description = args.description?.trim();

  if (method === "ekklesia-vote") {
    return { summary: "Governance vote package" };
  }

  if (method) {
    return { summary: `Sign ${method}` };
  }

  if (description?.toLowerCase().includes("governance")) {
    return { summary: "Governance action" };
  }

  return null;
}

export function summarizeDescriptionSignatureContext(
  description?: string | null,
): SignatureContext | null {
  const trimmed = description?.trim();
  if (!trimmed) return null;

  if (!/(governance|vote|drep|delegate|stake|certificate)/i.test(trimmed)) {
    return null;
  }

  return {
    summary: `Governance action: ${trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed}`,
  };
}
