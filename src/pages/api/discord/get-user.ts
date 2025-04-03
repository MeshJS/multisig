import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { discordId } = req.query;

  if (!discordId || typeof discordId !== "string") {
    return res.status(400).json({ error: "Discord ID is required" });
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
      return res.status(response.status).json({
        error: "Failed to fetch Discord user data",
        details: await response.text(),
      });
    }

    const userData = await response.json();

    // Return the user data
    res.status(200).json(userData);
  } catch (error) {
    console.error("Discord user fetch error:", error);
    res.status(500).json({ error: "Failed to fetch Discord user data" });
  }
}
