import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextApiResponse,
} from "next";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SITE_URL } from "@/lib/seo";
import handler from "@/pages/api/v1/botSetupGuide";
import BotSetupPage, { getServerSideProps } from "@/pages/bot-setup";

function apiResponse(method: string, headers: NextApiRequest["headers"]) {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
    end: jest.fn(),
  };
  res.status.mockReturnValue(res);
  handler(
    { method, headers } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
}

beforeEach(() => {
  // Any accidental server-side request is intercepted, including private targets.
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("untrusted upstream"));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot setup guide security boundary", () => {
  it.each<NextApiRequest["headers"]>([
    {},
    { host: new URL(SITE_URL).host, "x-forwarded-proto": "https" },
    { host: "169.254.169.254", "x-forwarded-proto": "http" },
    { host: "[::1]:3000", "x-forwarded-proto": "http" },
    { host: "attacker.example", "x-forwarded-proto": "https" },
    { host: "attacker.example", "x-forwarded-proto": "javascript:alert(1)//" },
    {
      host: "trusted.example@attacker.example",
      "x-forwarded-proto": ["http", "https"],
    },
  ])(
    "ignores request headers %j and renders the local guide without fetching",
    async (headers) => {
      const result = await getServerSideProps({
        req: { headers },
      } as unknown as GetServerSidePropsContext);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      if (!("props" in result)) throw new Error("Expected guide props");
      const props = await result.props;
      const res = apiResponse("GET", headers);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(props.markdown);
      expect(props.markdown).toContain(`Instance base URL: \`${SITE_URL}\``);
      expect(props.markdown).toContain(`POST ${SITE_URL}/api/v1/botRegister`);
      expect(props.markdown).toContain(`POST ${SITE_URL}/api/v1/botAuth`);
      expect(props.markdown).not.toContain("attacker.example");
      expect(props.markdown).not.toContain("169.254.169.254");
      expect(props.markdown).not.toContain("javascript:");

      const html = renderToStaticMarkup(
        React.createElement(BotSetupPage, props),
      );
      expect(html).toContain('href="/api/v1/botSetupGuide"');
      expect(html).toContain("Mesh Multisig Bot Setup Guide</h1>");
      expect(html).not.toContain("attacker.example");
      expect(html).not.toContain("javascript:");
    },
  );

  it("preserves the raw API response headers", () => {
    const res = apiResponse("GET", {});
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/markdown; charset=utf-8",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=300",
    );
  });

  it("continues to reject non-GET API requests", () => {
    const res = apiResponse("POST", {});
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.setHeader).toHaveBeenCalledWith("Allow", "GET");
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
