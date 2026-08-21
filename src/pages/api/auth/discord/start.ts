import { type NextApiRequest, type NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { env } from "@/env";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";

const { sign } = jwt;

// Mints a signed, short-lived OAuth state token and returns the Discord
// authorize URL. The state is a JWT bound to the caller's session address
// plus a random nonce; the callback (`/api/auth/discord/callback.ts`)
// verifies it before binding a discord ID. Without this, the previous
// `state = userAddress` shape was forgeable and CSRF-able.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = getWalletSessionFromReq(req);
  const primary = session?.primaryWallet ?? session?.wallets?.[0];
  if (!primary) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "Discord client not configured" });
  }

  const redirectBase =
    env.NODE_ENV === "production"
      ? "https://multisig.meshjs.dev"
      : "http://localhost:3000";
  const redirectUri = `${redirectBase}/api/auth/discord/callback`;

  const nonce = randomBytes(16).toString("hex");
  const state = sign(
    { address: primary, nonce },
    env.JWT_SECRET,
    { expiresIn: "10m" },
  );

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);

  return res.status(200).json({ url: url.toString() });
}
