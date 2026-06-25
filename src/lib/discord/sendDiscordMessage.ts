export default async function sendDiscordMessage(
  discordIds: string[],
  message: string,
) {
  const response = await fetch("/api/discord/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ discordIds, message }),
  });

  if (!response.ok) {
    throw new Error("Failed to send Discord messages");
  }

  return response.json();
}
