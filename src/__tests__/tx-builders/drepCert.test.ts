import { describe, it, expect } from "@jest/globals";
import { applyDRepCert } from "@/lib/tx-builders/buildDRepCertTx";
import {
  FIXTURE_UTXOS,
  CHANGE_ADDRESS,
  DREP_SCRIPT_CBOR,
  STAKING_SCRIPT_CBOR,
} from "./fixtures";

const DREP_ID = "drep1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe7g7h6";
const ANCHOR = {
  anchorUrl: "https://example.com/drep.json",
  anchorDataHash: "0".repeat(64),
};

interface BuilderCall {
  method: string;
  args: unknown[];
}

function createDRepBuilderMock() {
  const calls: BuilderCall[] = [];

  const builder = {
    txIn: (...args: unknown[]) => { calls.push({ method: "txIn", args }); return builder; },
    txInScript: (...args: unknown[]) => { calls.push({ method: "txInScript", args }); return builder; },
    drepRegistrationCertificate: (...args: unknown[]) => { calls.push({ method: "drepRegistrationCertificate", args }); return builder; },
    drepUpdateCertificate: (...args: unknown[]) => { calls.push({ method: "drepUpdateCertificate", args }); return builder; },
    drepDeregistrationCertificate: (...args: unknown[]) => { calls.push({ method: "drepDeregistrationCertificate", args }); return builder; },
    certificateScript: (...args: unknown[]) => { calls.push({ method: "certificateScript", args }); return builder; },
    changeAddress: (...args: unknown[]) => { calls.push({ method: "changeAddress", args }); return builder; },
  };

  return { builder, calls };
}

describe("applyDRepCert", () => {
  it("register calls drepRegistrationCertificate with anchor", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "register",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
      anchor: ANCHOR,
    });

    const certCall = calls.find(c => c.method === "drepRegistrationCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(DREP_ID);
    expect(certCall!.args[1]).toEqual(ANCHOR);
  });

  it("update calls drepUpdateCertificate with anchor", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "update",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
      anchor: ANCHOR,
    });

    const certCall = calls.find(c => c.method === "drepUpdateCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(DREP_ID);
    expect(certCall!.args[1]).toEqual(ANCHOR);
  });

  it("retire calls drepDeregistrationCertificate without anchor", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "retire",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
    });

    const certCall = calls.find(c => c.method === "drepDeregistrationCertificate");
    expect(certCall).toBeDefined();
    expect(certCall!.args[0]).toBe(DREP_ID);
  });

  it("register without anchor throws", () => {
    const { builder } = createDRepBuilderMock();
    expect(() => {
      applyDRepCert(builder as never, {
        action: "register",
        dRepId: DREP_ID,
        drepCbor: DREP_SCRIPT_CBOR,
        scriptCbor: DREP_SCRIPT_CBOR,
        changeAddress: CHANGE_ADDRESS,
        utxos: FIXTURE_UTXOS,
      });
    }).toThrow("anchor is required for DRep register");
  });

  it("update without anchor throws", () => {
    const { builder } = createDRepBuilderMock();
    expect(() => {
      applyDRepCert(builder as never, {
        action: "update",
        dRepId: DREP_ID,
        drepCbor: DREP_SCRIPT_CBOR,
        scriptCbor: DREP_SCRIPT_CBOR,
        changeAddress: CHANGE_ADDRESS,
        utxos: FIXTURE_UTXOS,
      });
    }).toThrow("anchor is required for DRep update");
  });

  it("legacy wallet: skips certificateScript when drepCbor === scriptCbor", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "retire",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
    });

    expect(calls.find(c => c.method === "certificateScript")).toBeUndefined();
  });

  it("SDK wallet: adds certificateScript when drepCbor !== scriptCbor", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "retire",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: STAKING_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
    });

    const certScriptCall = calls.find(c => c.method === "certificateScript");
    expect(certScriptCall).toBeDefined();
    expect(certScriptCall!.args[0]).toBe(DREP_SCRIPT_CBOR);
  });

  it("calls txIn + txInScript for each UTxO", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "retire",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
    });

    expect(calls.filter(c => c.method === "txIn")).toHaveLength(FIXTURE_UTXOS.length);
    expect(calls.filter(c => c.method === "txInScript")).toHaveLength(FIXTURE_UTXOS.length);
  });

  it("sets changeAddress", () => {
    const { builder, calls } = createDRepBuilderMock();
    applyDRepCert(builder as never, {
      action: "retire",
      dRepId: DREP_ID,
      drepCbor: DREP_SCRIPT_CBOR,
      scriptCbor: DREP_SCRIPT_CBOR,
      changeAddress: CHANGE_ADDRESS,
      utxos: FIXTURE_UTXOS,
    });

    const changeCall = calls.find(c => c.method === "changeAddress");
    expect(changeCall).toBeDefined();
    expect(changeCall!.args[0]).toBe(CHANGE_ADDRESS);
  });
});
