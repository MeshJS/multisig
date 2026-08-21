/**
 * useWalletImportFlowState
 *
 * Cross-step state for the import-wallet wizard. The wizard is intentionally
 * single-page (source/review/ready as internal steps) because the import
 * flow has no NewWallet draft round trip and we want state to survive
 * step transitions without serializing megabyte-scale payloads through
 * sessionStorage or URL params.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";

import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

export type ImportSource = "summon" | "instance" | "cbor" | "json";

export type ImportStep = "source" | "review" | "ready";

export type InstanceSourceMeta = {
  source: "instance";
  originUrl: string;
  originalWalletId: string;
  verifiedSigner: string;
};

export type JsonSourceMeta = {
  source: "json";
  sourceInstance: string;
  payloadHash: string;
};

export type CborSourceMeta = {
  source: "cbor";
  verifiedSigner: string;
};

export type SourceMeta = InstanceSourceMeta | JsonSourceMeta | CborSourceMeta;

export type ResolvedWalletPayload = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  signersAddresses: string[];
  signersStakeKeys: string[];
  signersDRepKeys: string[];
  signersDescriptions: string[];
  numRequiredSigners: number | null;
  scriptCbor: string;
  stakeCredentialHash: string | null;
  type: string;
  rawImportBodies: unknown;
};

export type CborImportInput = {
  name: string;
  description: string;
  signersAddresses: string[];
  signersStakeKeys: string[];
  signersDRepKeys: string[];
  signersDescriptions: string[];
  scriptCbor: string;
  numRequiredSigners: number;
  scriptType: "all" | "any" | "atLeast";
  stakeCredentialHash?: string | null;
};

export interface WalletImportFlowState {
  router: ReturnType<typeof useRouter>;
  userAddress: string | undefined;
  loading: boolean;
  step: ImportStep;
  createdWalletId: string | null;

  resolvedPayload: ResolvedWalletPayload | null;
  cborInput: CborImportInput | null;
  sourceMeta: SourceMeta | null;

  setInstanceResult: (payload: ResolvedWalletPayload, meta: InstanceSourceMeta) => void;
  setJsonResult: (payload: ResolvedWalletPayload, meta: JsonSourceMeta) => void;
  setCborResult: (input: CborImportInput, meta: CborSourceMeta) => void;
  backToSource: () => void;
  reset: () => void;

  submitImport: () => Promise<void>;
}

export function useWalletImportFlowState(): WalletImportFlowState {
  const router = useRouter();
  const { toast } = useToast();
  const userAddress = useUserStore((s) => s.userAddress);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<ImportStep>("source");
  const [createdWalletId, setCreatedWalletId] = useState<string | null>(null);

  const [resolvedPayload, setResolvedPayload] = useState<ResolvedWalletPayload | null>(null);
  const [cborInput, setCborInput] = useState<CborImportInput | null>(null);
  const [sourceMeta, setSourceMeta] = useState<SourceMeta | null>(null);

  const { mutateAsync: importWallet } = api.wallet.importWallet.useMutation();

  const setInstanceResult = useCallback(
    (payload: ResolvedWalletPayload, meta: InstanceSourceMeta) => {
      setResolvedPayload(payload);
      setCborInput(null);
      setSourceMeta(meta);
      setStep("review");
    },
    [],
  );

  const setJsonResult = useCallback(
    (payload: ResolvedWalletPayload, meta: JsonSourceMeta) => {
      setResolvedPayload(payload);
      setCborInput(null);
      setSourceMeta(meta);
      setStep("review");
    },
    [],
  );

  const setCborResult = useCallback(
    (input: CborImportInput, meta: CborSourceMeta) => {
      setResolvedPayload(null);
      setCborInput(input);
      setSourceMeta(meta);
      setStep("review");
    },
    [],
  );

  const backToSource = useCallback(() => {
    setStep("source");
  }, []);

  const reset = useCallback(() => {
    setResolvedPayload(null);
    setCborInput(null);
    setSourceMeta(null);
    setLoading(false);
    setCreatedWalletId(null);
    setStep("source");
  }, []);

  const submitImport = useCallback(async () => {
    if (!sourceMeta) {
      toast({
        title: "Nothing to import",
        description: "Start over from the source step.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      let wallet;
      if (sourceMeta.source === "instance" && resolvedPayload) {
        wallet = await importWallet({
          source: "instance",
          originUrl: sourceMeta.originUrl,
          originalWalletId: sourceMeta.originalWalletId,
          verifiedSigner: sourceMeta.verifiedSigner,
          payload: resolvedPayload,
        });
      } else if (sourceMeta.source === "json" && resolvedPayload) {
        wallet = await importWallet({
          source: "json",
          sourceInstance: sourceMeta.sourceInstance,
          payload: resolvedPayload,
          payloadHash: sourceMeta.payloadHash,
        });
      } else if (sourceMeta.source === "cbor" && cborInput) {
        wallet = await importWallet({
          source: "cbor",
          name: cborInput.name,
          description: cborInput.description,
          signersAddresses: cborInput.signersAddresses,
          signersStakeKeys: cborInput.signersStakeKeys,
          signersDRepKeys: cborInput.signersDRepKeys,
          signersDescriptions: cborInput.signersDescriptions,
          scriptCbor: cborInput.scriptCbor,
          numRequiredSigners: cborInput.numRequiredSigners,
          scriptType: cborInput.scriptType,
          stakeCredentialHash: cborInput.stakeCredentialHash ?? null,
          verifiedSigner: sourceMeta.verifiedSigner,
        });
      } else {
        throw new Error("Inconsistent import state");
      }
      toast({
        title: "Wallet imported",
        description: "The wallet now appears in your sidebar.",
        duration: 3000,
      });
      setCreatedWalletId(wallet.id);
      setStep("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast({
        title: "Import failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [sourceMeta, resolvedPayload, cborInput, importWallet, toast]);

  const state = useMemo<WalletImportFlowState>(
    () => ({
      router,
      userAddress,
      loading,
      step,
      createdWalletId,
      resolvedPayload,
      cborInput,
      sourceMeta,
      setInstanceResult,
      setJsonResult,
      setCborResult,
      backToSource,
      reset,
      submitImport,
    }),
    [
      router,
      userAddress,
      loading,
      step,
      createdWalletId,
      resolvedPayload,
      cborInput,
      sourceMeta,
      setInstanceResult,
      setJsonResult,
      setCborResult,
      backToSource,
      reset,
      submitImport,
    ],
  );

  return state;
}
