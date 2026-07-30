import type {
  DraftOutput,
  DraftUtxoSelection,
  TxDraft,
} from "@/types/tx-draft";
import { safeBigInt } from "./assets";

/**
 * Pure draft mutations: every function returns a new draft and never touches
 * its input, so the zustand store stays a thin wrapper and everything here is
 * trivially unit-testable.
 */

function generateId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraft(id?: string): TxDraft {
  return {
    id: id ?? generateId(),
    outputs: [],
    utxoSelection: { mode: "auto" },
    description: "",
    metadata: "",
    certificates: [],
    votes: [],
  };
}

export function addOutput(
  draft: TxDraft,
  partial?: Partial<DraftOutput>,
): { draft: TxDraft; outputId: string } {
  const outputId = partial?.id ?? generateId();
  const output: DraftOutput = {
    id: outputId,
    address: partial?.address ?? "",
    assets: partial?.assets ?? [],
  };
  return { draft: { ...draft, outputs: [...draft.outputs, output] }, outputId };
}

export function updateOutput(
  draft: TxDraft,
  outputId: string,
  patch: Partial<Omit<DraftOutput, "id">>,
): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.map((output) =>
      output.id === outputId ? { ...output, ...patch } : output,
    ),
  };
}

export function removeOutput(draft: TxDraft, outputId: string): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.filter((output) => output.id !== outputId),
  };
}

/**
 * Upserts one asset on an output; a zero quantity removes the entry so the
 * inspector's amount field can clear an asset without a separate action.
 */
export function setOutputAsset(
  draft: TxDraft,
  outputId: string,
  unit: string,
  quantity: string,
): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.map((output) => {
      if (output.id !== outputId) return output;
      if (safeBigInt(quantity) === 0n) {
        return {
          ...output,
          assets: output.assets.filter((asset) => asset.unit !== unit),
        };
      }
      const exists = output.assets.some((asset) => asset.unit === unit);
      return {
        ...output,
        // Update in place so inspector asset rows keep their order.
        assets: exists
          ? output.assets.map((asset) =>
              asset.unit === unit ? { unit, quantity } : asset,
            )
          : [...output.assets, { unit, quantity }],
      };
    }),
  };
}

export function setUtxoSelection(
  draft: TxDraft,
  utxoSelection: DraftUtxoSelection,
): TxDraft {
  return { ...draft, utxoSelection };
}

export function setChangeAddress(
  draft: TxDraft,
  changeAddress: string | undefined,
): TxDraft {
  return { ...draft, changeAddress };
}

export function setDescription(draft: TxDraft, description: string): TxDraft {
  return { ...draft, description };
}

export function setMetadata(draft: TxDraft, metadata: string): TxDraft {
  return { ...draft, metadata };
}
