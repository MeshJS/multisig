import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "No code provided" });
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        code: code as string,
        grant_type: "authorization_code",
        redirect_uri: `http://localhost:3000/api/auth/discord/callback`,
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error("Token error:", tokens);
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

    console.log("VERIFIED DISCORD USER", user);
    // TODO: Store the Discord user ID database here once migration is made
    // Then redirect
    res.redirect("/");
  } catch (error) {
    console.error("Discord auth error:", error);
    res.status(500).json({ error: "Failed to authenticate with Discord" });
  }
}
