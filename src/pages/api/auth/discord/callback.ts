import { type NextApiRequest, type NextApiResponse } from "next";
import { db } from "@/server/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: "No code provided" });
  }

  if (!state) {
    return res.status(400).json({ error: "No state provided" });
  }

  const userAddress = decodeURIComponent(state as string);

  try {
    const redirectUri =
      process.env.NODE_ENV === "production"
        ? "https://multisig.meshjs.dev/api/auth/discord/callback"
        : "http://localhost:3000/api/auth/discord/callback";

    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      code: code as string,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    // Log exactly what you’re sending:
    console.log("→ [Discord Token] POST body:", params.toString());

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    // Read it once as text, then JSON.parse
    const raw = await tokenResponse.text();
    console.log("← [Discord Token] status:", tokenResponse.status);
    console.log("← [Discord Token] body:", raw);

    let tokens;
    try {
      tokens = JSON.parse(raw);
    } catch {
      throw new Error("Discord returned non‑JSON on token exchange");
    }

    if (tokens.error) {
      console.error(
        "↪︎ [Discord Token] error_description:",
        tokens.error_description,
      );
      return res.status(400).json({ error: tokens.error_description });
    }

    // Get user info using the access token
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
    });

    const user = await userResponse.json();
    if (user) {
      // Store Discord ID in database
      await db.user.update({
        where: { address: userAddress },
        data: { discordId: user.id },
      });

      // Check if user is in the guild
      const guildId = process.env.DISCORD_GUILD_ID;
      const guildMemberCheck = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
        },
      );

      if (guildMemberCheck.status === 404) {
        // Redirect to invite link
        return res.redirect("https://discord.gg/DkNPvvGTqK");
      }
    }

    // Then redirect
    res.redirect("/");
  } catch (error) {
    console.error("Discord auth error:", error);
    res.status(500).json({ error: "Failed to authenticate with Discord" });
  }
}
