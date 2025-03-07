import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { discordIds, message } = req.body;

  try {
    for (const discordId of discordIds) {
      // Create DM Channel
      const response = await fetch(
        "https://discord.com/api/v10/users/@me/channels",
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recipient_id: discordId }),
        },
      );

      const dmChannel = await response.json();

      if (dmChannel.id) {
        await fetch(
          `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content: message }),
          },
        );
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Discord message error:", error);
    res.status(500).json({ error: "Failed to send Discord messages" });
  }
}
