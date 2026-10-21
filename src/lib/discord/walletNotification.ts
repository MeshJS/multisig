import type { PrismaClient } from "@prisma/client";

/**
 * Discord user ids are snowflakes: unsigned 64-bit integers written in
 * decimal. Anything else is rejected before it reaches a Discord API URL,
 * where a value like `@me/guilds` or `../channels/…` would otherwise address
 * a different endpoint with the bot's token.
 */
export const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;

export const isDiscordSnowflake = (value: unknown): value is string =>
  typeof value === "string" && DISCORD_SNOWFLAKE_RE.test(value);

/**
 * The notifications the app sends. The server writes the text from these
 * templates instead of relaying caller-supplied text: the bot speaks for the
 * project, and anyone can create a wallet listing arbitrary public addresses
 * as signers, so "only co-signers" alone would still let a stranger send
 * phishing text to people who never joined their wallet.
 */
export const DISCORD_NOTIFICATION_KINDS = [
  "newTransaction",
  "ccVote",
  "transactionReminder",
  "datumReminder",
] as const;
export type DiscordNotificationKind = (typeof DISCORD_NOTIFICATION_KINDS)[number];

export const isDiscordNotificationKind = (
  value: unknown,
): value is DiscordNotificationKind =>
  typeof value === "string" &&
  (DISCORD_NOTIFICATION_KINDS as readonly string[]).includes(value);

/** Wallet ids are cuids; this also keeps the id safe to put in a link. */
export const isWalletId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/**
 * The wallet name is the one caller-chosen string left in the message, so it
 * goes in inline code: Discord renders no links, mentions or markdown there.
 */
export function formatWalletName(name: string): string {
  const flat = [
    ...name
      // Bidi overrides and zero-width characters would let the name display
      // as text it does not contain.
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .replace(/[`\s]+/g, " ")
      .trim(),
  ]
    .slice(0, 100)
    .join("");
  return `\`${flat || "Unnamed wallet"}\``;
}

export function buildDiscordNotification(
  kind: DiscordNotificationKind,
  wallet: { id: string; name: string },
  siteUrl: string,
): string {
  const name = formatWalletName(wallet.name);
  const base = `${siteUrl}/wallets/${wallet.id}`;
  switch (kind) {
    case "newTransaction":
      return `**NEW MULTISIG TRANSACTION:** A new Multisig transaction has been created for your wallet: ${name}. Review it here: ${base}/transactions`;
    case "ccVote":
      return `**NEW MULTISIG TRANSACTION:** A new CC Vote was created for your wallet: ${name}. Review it here: ${base}/transactions`;
    case "transactionReminder":
      return `**REMINDER:** Your signature is needed for a transaction in ${name}. Review it here: ${base}/transactions`;
    case "datumReminder":
      return `**REMINDER:** Your signature is needed for a Datum in ${name}. Review it here: ${base}/signing`;
  }
}

type NotificationDb = Pick<PrismaClient, "wallet" | "user">;

export type WalletNotificationAccess =
  | { ok: true; wallet: { id: string; name: string }; permitted: Set<string> }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Whether the session may notify about `walletId`, and which of `discordIds`
 * it may reach: the caller must be a signer or the owner of the wallet (the
 * same rule as `assertWalletAccess`), and recipients must be Discord ids
 * registered to that wallet's signers.
 */
export async function authorizeWalletNotification(
  db: NotificationDb,
  walletId: string,
  sessionAddresses: readonly string[],
  discordIds: readonly string[],
): Promise<WalletNotificationAccess> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, name: true, signersAddresses: true, ownerAddress: true },
  });
  if (!wallet) return { ok: false, status: 404, error: "Wallet not found" };

  const isMember = sessionAddresses.some(
    (addr) => wallet.signersAddresses.includes(addr) || wallet.ownerAddress === addr,
  );
  if (!isMember) {
    return { ok: false, status: 403, error: "Not authorized for this wallet" };
  }

  if (discordIds.length === 0 || wallet.signersAddresses.length === 0) {
    return { ok: true, wallet, permitted: new Set() };
  }
  const users = await db.user.findMany({
    where: {
      address: { in: wallet.signersAddresses },
      discordId: { in: [...discordIds] },
    },
    select: { discordId: true },
  });
  return {
    ok: true,
    wallet,
    permitted: new Set(users.map((u) => u.discordId).filter(Boolean)),
  };
}
