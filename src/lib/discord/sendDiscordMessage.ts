import type { DiscordNotificationKind } from "./walletNotification";

/**
 * Asks the server to DM `discordIds` (signers of `walletId`) about the
 * wallet. The server writes the message from `kind`; see
 * `src/pages/api/discord/send-message.ts`.
 */
export default async function sendDiscordMessage(
  walletId: string,
  kind: DiscordNotificationKind,
  discordIds: string[],
) {
  const response = await fetch("/api/discord/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ walletId, kind, discordIds }),
  });

  if (!response.ok) {
    throw new Error("Failed to send Discord messages");
  }

  return response.json();
}
