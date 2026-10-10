import {
  addCertificate,
  addOutput,
  addStakeAction,
  addVote,
  clearVoteAnchor,
  updateCertificatePool,
  createDraft,
  removeCertificate,
  removeOutput,
  removeVote,
  setDescription,
  setMetadata,
  setOutputAsset,
  setUtxoSelection,
  setVoteRationale,
  updateOutput,
  updateVoteKind,
  withVoteAnchor,
} from "@/lib/tx-draft/mutations";

describe("tx-draft mutations", () => {
  test("createDraft returns an empty auto-mode draft with unique ids", () => {
    const a = createDraft();
    const b = createDraft();
    expect(a.outputs).toEqual([]);
    expect(a.utxoSelection).toEqual({ mode: "auto" });
    expect(a.description).toBe("");
    expect(a.metadata).toBe("");
    expect(a.certificates).toEqual([]);
    expect(a.votes).toEqual([]);
    expect(a.id).not.toBe(b.id);
    expect(createDraft("fixed").id).toBe("fixed");
  });

  test("addOutput appends without mutating the original draft", () => {
    const draft = createDraft("d1");
    const { draft: next, outputId } = addOutput(draft, {
      address: "addr_test1x",
    });
    expect(draft.outputs).toHaveLength(0); // immutability
    expect(next.outputs).toHaveLength(1);
    expect(next.outputs[0]).toEqual({
      id: outputId,
      address: "addr_test1x",
      assets: [],
    });
    // Explicit ids (used by tests and the store) are respected.
    const { draft: withId } = addOutput(next, { id: "out-2" });
    expect(withId.outputs[1]!.id).toBe("out-2");
    expect(withId.outputs[1]!.address).toBe("");
  });

  test("updateOutput patches only the targeted output", () => {
    let { draft } = addOutput(createDraft("d1"), { id: "a" });
    ({ draft } = addOutput(draft, { id: "b" }));
    const next = updateOutput(draft, "b", { address: "addr_test1y" });
    expect(next.outputs[0]!.address).toBe("");
    expect(next.outputs[1]!.address).toBe("addr_test1y");
    expect(next.outputs[1]!.id).toBe("b");
  });

  test("removeOutput drops the targeted output", () => {
    let { draft } = addOutput(createDraft("d1"), { id: "a" });
    ({ draft } = addOutput(draft, { id: "b" }));
    const next = removeOutput(draft, "a");
    expect(next.outputs.map((o) => o.id)).toEqual(["b"]);
  });

  describe("setOutputAsset", () => {
    const base = () =>
      addOutput(createDraft("d1"), {
        id: "a",
        assets: [
          { unit: "lovelace", quantity: "1000000" },
          { unit: "policy1token", quantity: "5" },
        ],
      }).draft;

    test("adds a new asset", () => {
      const next = setOutputAsset(base(), "a", "policy2token", "7");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "1000000" },
        { unit: "policy1token", quantity: "5" },
        { unit: "policy2token", quantity: "7" },
      ]);
    });

    test("updates in place, preserving row order", () => {
      const next = setOutputAsset(base(), "a", "lovelace", "2000000");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "2000000" },
        { unit: "policy1token", quantity: "5" },
      ]);
    });

    test("removes the asset at zero quantity", () => {
      const next = setOutputAsset(base(), "a", "policy1token", "0");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "1000000" },
      ]);
    });
  });

  test("scalar setters replace their field only", () => {
    const draft = createDraft("d1");
    expect(setDescription(draft, "hello").description).toBe("hello");
    expect(setMetadata(draft, "on-chain").metadata).toBe("on-chain");
    const manual = setUtxoSelection(draft, { mode: "manual", utxos: [] });
    expect(manual.utxoSelection.mode).toBe("manual");
    expect(draft.utxoSelection.mode).toBe("auto"); // original untouched
  });
});

describe("tx-draft vote mutations", () => {
  const baseVote = {
    govActionTxHash: "a".repeat(64),
    govActionIndex: 2,
    voteKind: "Yes" as const,
    anchor: { anchorUrl: "ipfs://cid", anchorDataHash: "b".repeat(64) },
    originalDrepId: "drep1abc",
  };

  function draftWithVote() {
    const { draft, voteId } = addVote(createDraft("d1"), baseVote);
    return { draft, voteId };
  }

  test("addVote appends with a generated id without mutating the input", () => {
    const original = createDraft("d1");
    const { draft, voteId } = addVote(original, baseVote);
    expect(original.votes).toHaveLength(0); // immutability
    expect(draft.votes).toEqual([{ ...baseVote, id: voteId }]);
    // Explicit ids are respected.
    const { draft: withId } = addVote(draft, { ...baseVote, id: "v-2" });
    expect(withId.votes[1]!.id).toBe("v-2");
  });

  test("updateVoteKind changes only the target vote and keeps the anchor", () => {
    const { draft, voteId } = draftWithVote();
    const { draft: two } = addVote(draft, { ...baseVote, id: "v-2" });
    const next = updateVoteKind(two, voteId, "No");
    expect(next.votes.find((v) => v.id === voteId)).toMatchObject({
      voteKind: "No",
      anchor: baseVote.anchor,
    });
    expect(next.votes.find((v) => v.id === "v-2")!.voteKind).toBe("Yes");
    expect(two.votes.find((v) => v.id === voteId)!.voteKind).toBe("Yes");
  });

  test("removeVote filters the target vote", () => {
    const { draft, voteId } = draftWithVote();
    const next = removeVote(draft, voteId);
    expect(next.votes).toHaveLength(0);
    expect(draft.votes).toHaveLength(1); // original untouched
  });

  test("clearVoteAnchor strips only the anchor", () => {
    const { draft, voteId } = draftWithVote();
    const next = clearVoteAnchor(draft, voteId);
    expect(next.votes[0]).toEqual({
      id: voteId,
      govActionTxHash: baseVote.govActionTxHash,
      govActionIndex: 2,
      voteKind: "Yes",
      originalDrepId: "drep1abc",
    });
    expect(next.votes[0]!.anchor).toBeUndefined();
    expect(draft.votes[0]!.anchor).toEqual(baseVote.anchor);
  });
});

describe("tx-draft certificate mutations", () => {
  const baseCert = {
    kind: "DelegateStake" as const,
    poolId: "pool1old",
    originalStakeAddress: "stake_test1abc",
  };

  test("addCertificate appends with a generated id without mutating the input", () => {
    const original = createDraft("d1");
    const { draft, certificateId } = addCertificate(original, baseCert);
    expect(original.certificates).toHaveLength(0); // immutability
    expect(draft.certificates).toEqual([{ ...baseCert, id: certificateId }]);
    // Explicit ids are respected.
    const { draft: withId } = addCertificate(draft, {
      kind: "RegisterStake",
      id: "c-2",
    });
    expect(withId.certificates[1]!.id).toBe("c-2");
  });

  test("updateCertificatePool patches only the target delegation cert", () => {
    let { draft } = addCertificate(createDraft("d1"), {
      ...baseCert,
      id: "c-1",
    });
    ({ draft } = addCertificate(draft, { ...baseCert, id: "c-2" }));

    const next = updateCertificatePool(draft, "c-1", "pool1new");
    expect(next.certificates[0]).toMatchObject({
      poolId: "pool1new",
      originalStakeAddress: baseCert.originalStakeAddress,
    });
    expect(next.certificates[1]!.poolId).toBe("pool1old");
    expect(draft.certificates[0]!.poolId).toBe("pool1old"); // original untouched
  });

  test("updateCertificatePool is a no-op on non-delegation certs", () => {
    const { draft } = addCertificate(createDraft("d1"), {
      kind: "RegisterStake",
      id: "c-1",
    });
    const next = updateCertificatePool(draft, "c-1", "pool1new");
    expect(next.certificates[0]!.poolId).toBeUndefined();
  });
});

describe("tx-draft stake action mutations", () => {
  test("registerAndDelegate adds a register-first pair sharing a pairId", () => {
    const original = createDraft("d1");
    const { draft, certificateIds } = addStakeAction(original, {
      type: "registerAndDelegate",
      poolId: "pool1new",
    });
    expect(original.certificates).toHaveLength(0); // immutability
    expect(certificateIds).toHaveLength(2);
    const [register, delegate] = draft.certificates;
    expect(register).toMatchObject({
      id: certificateIds[0],
      kind: "RegisterStake",
      origin: "user",
    });
    expect(delegate).toMatchObject({
      id: certificateIds[1],
      kind: "DelegateStake",
      poolId: "pool1new",
      origin: "user",
    });
    expect(register!.poolId).toBeUndefined();
    expect(register!.pairId).toBeDefined();
    expect(delegate!.pairId).toBe(register!.pairId);
  });

  test("delegate adds a single unpaired user cert with the pool", () => {
    const { draft, certificateIds } = addStakeAction(createDraft("d1"), {
      type: "delegate",
      poolId: "pool1new",
    });
    expect(certificateIds).toHaveLength(1);
    expect(draft.certificates).toEqual([
      {
        id: certificateIds[0],
        kind: "DelegateStake",
        poolId: "pool1new",
        origin: "user",
      },
    ]);
  });

  test("deregister adds a single unpaired user cert without a pool", () => {
    const { draft } = addStakeAction(createDraft("d1"), {
      type: "deregister",
    });
    expect(draft.certificates).toHaveLength(1);
    expect(draft.certificates[0]).toMatchObject({
      kind: "DeregisterStake",
      origin: "user",
    });
    expect(draft.certificates[0]!.poolId).toBeUndefined();
    expect(draft.certificates[0]!.pairId).toBeUndefined();
  });

  test("removeCertificate drops a lone user cert", () => {
    const { draft, certificateIds } = addStakeAction(createDraft("d1"), {
      type: "delegate",
      poolId: "pool1new",
    });
    const next = removeCertificate(draft, certificateIds[0]!);
    expect(next.certificates).toHaveLength(0);
    expect(draft.certificates).toHaveLength(1); // original untouched
  });

  test("removeCertificate removes both halves of a pair from either half", () => {
    const { draft, certificateIds } = addStakeAction(createDraft("d1"), {
      type: "registerAndDelegate",
      poolId: "pool1new",
    });
    for (const id of certificateIds) {
      expect(removeCertificate(draft, id).certificates).toHaveLength(0);
    }
  });

  test("removeCertificate is a no-op on loaded certs and unknown ids", () => {
    const { draft } = addCertificate(createDraft("d1"), {
      kind: "DelegateStake",
      poolId: "pool1old",
      originalStakeAddress: "stake_test1abc",
      id: "loaded-1",
    });
    expect(removeCertificate(draft, "loaded-1")).toBe(draft);
    expect(removeCertificate(draft, "missing")).toBe(draft);
  });

  test("removeCertificate leaves other certs intact", () => {
    const { draft } = addCertificate(createDraft("d1"), {
      kind: "DeregisterStake",
      originalStakeAddress: "stake_test1abc",
      id: "loaded-1",
    });
    const added = addStakeAction(draft, {
      type: "delegate",
      poolId: "pool1new",
    });
    const next = removeCertificate(added.draft, added.certificateIds[0]!);
    expect(next.certificates.map((c) => c.id)).toEqual(["loaded-1"]);
  });
});

describe("tx-draft vote rationale mutations", () => {
  const anchor = { anchorUrl: "ipfs://old", anchorDataHash: "b".repeat(64) };

  function draftWithVote() {
    return addVote(createDraft("d1"), {
      id: "v-1",
      govActionTxHash: "a".repeat(64),
      govActionIndex: 0,
      voteKind: "Yes",
      anchor,
    }).draft;
  }

  test("setVoteRationale sets text on the target vote only, immutably", () => {
    const base = addVote(draftWithVote(), {
      id: "v-2",
      govActionTxHash: "c".repeat(64),
      govActionIndex: 1,
      voteKind: "No",
    }).draft;
    const next = setVoteRationale(base, "v-1", "new reasoning");
    expect(next.votes[0]!.rationaleEdit).toBe("new reasoning");
    expect(next.votes[0]!.anchor).toEqual(anchor); // anchor untouched until build
    expect("rationaleEdit" in next.votes[1]!).toBe(false);
    expect("rationaleEdit" in base.votes[0]!).toBe(false); // original untouched
  });

  test("setVoteRationale(undefined) removes the key entirely", () => {
    const edited = setVoteRationale(draftWithVote(), "v-1", "text");
    const reverted = setVoteRationale(edited, "v-1", undefined);
    expect("rationaleEdit" in reverted.votes[0]!).toBe(false);
    expect(reverted.votes[0]!.anchor).toEqual(anchor);
  });

  test("setVoteRationale works on a vote without an anchor", () => {
    const base = addVote(createDraft("d1"), {
      id: "v-1",
      govActionTxHash: "a".repeat(64),
      govActionIndex: 0,
      voteKind: "Yes",
    }).draft;
    expect(setVoteRationale(base, "v-1", "added").votes[0]!.rationaleEdit).toBe(
      "added",
    );
  });

  test("withVoteAnchor replaces the anchor and consumes the edit", () => {
    const edited = setVoteRationale(draftWithVote(), "v-1", "text");
    const newAnchor = { anchorUrl: "ipfs://new", anchorDataHash: "d".repeat(64) };
    const next = withVoteAnchor(edited, "v-1", newAnchor);
    expect(next.votes[0]!.anchor).toEqual(newAnchor);
    expect("rationaleEdit" in next.votes[0]!).toBe(false);
  });

  test("withVoteAnchor(undefined) removes the anchor and the edit", () => {
    const edited = setVoteRationale(draftWithVote(), "v-1", "  ");
    const next = withVoteAnchor(edited, "v-1", undefined);
    expect("anchor" in next.votes[0]!).toBe(false);
    expect("rationaleEdit" in next.votes[0]!).toBe(false);
  });

  test("clearVoteAnchor drops a pending rationale edit too", () => {
    const edited = setVoteRationale(draftWithVote(), "v-1", "text");
    const next = clearVoteAnchor(edited, "v-1");
    expect("anchor" in next.votes[0]!).toBe(false);
    expect("rationaleEdit" in next.votes[0]!).toBe(false);
  });
});
