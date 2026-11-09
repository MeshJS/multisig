import { type NextApiRequest, type NextApiResponse } from "next";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { isDiscordSnowflake } from "@/lib/discord/walletNotification";

/**
 * Avatar lookup for a signer's Discord id, proxied because it needs the bot
 * token. Only the fields `getDiscordAvatar` renders are passed through.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "discordUser" })) return;

  const { discordId } = req.query;

  // The id is interpolated into a bot-authenticated Discord URL, so it must
  // be a plain snowflake, not a path.
  if (!isDiscordSnowflake(discordId)) {
    return res.status(400).json({ error: "A valid Discord ID is required" });
  }

  try {
    // Fetch user data from Discord API
    const response = await fetch(
      `https://discord.com/api/v10/users/${discordId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error("Discord API error:", response.status);
      return res
        .status(response.status === 404 ? 404 : 502)
        .json({ error: "Failed to fetch Discord user data" });
    }

    const userData = (await response.json()) as {
      id?: string;
      avatar?: string | null;
      discriminator?: string;
    };

    res.status(200).json({
      id: userData.id,
      avatar: userData.avatar ?? null,
      discriminator: userData.discriminator,
    });
  } catch (error) {
    console.error("Discord user fetch error:", error);
    res.status(500).json({ error: "Failed to fetch Discord user data" });
  }
}
