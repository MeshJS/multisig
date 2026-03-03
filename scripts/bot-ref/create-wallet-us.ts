/**
 * Create a 2-of-2 multisig "Owner + Bot" via the bot API.
 * The bot gets the owner's address from GET /api/v1/botMe (you are the bot's owner).
 * Usage: npx tsx create-wallet-us.ts
 */
import { loadConfig, botAuth, createWallet, getOwnerInfo, getBotMe } from "./bot-client";

async function main() {
  const config = await loadConfig();
  if (!config.paymentAddress) {
    console.error("bot-config must have paymentAddress (bot's address).");
    process.exit(1);
  }

  console.error("Authenticating bot...");
  const { token } = await botAuth(config);

  console.error("Fetching bot info (owner address)...");
  const botMe = await getBotMe(config.baseUrl, token);
  const ownerAddress = botMe.ownerAddress;
  if (!ownerAddress || !ownerAddress.startsWith("addr")) {
    console.error("Bot has no valid owner address. Ensure the bot was created by a connected wallet.");
    process.exit(1);
  }
  // Use bot address from config (so you can set a real address in bot-config.json);
  // call POST /api/v1/botAuth with that address once so the bot can sign.
  const botAddress = config.paymentAddress;
  const looksLikePlaceholder = /addr_test1qpx+x/.test(botAddress) || (botAddress.includes("xxx") && botAddress.length > 80);
  if (looksLikePlaceholder) {
    const base = config.baseUrl.replace(/\/$/, "");
    console.error("Bot address in config looks like a placeholder (invalid).");
    console.error("The bot must have its own wallet and address. Set paymentAddress in bot-config.json to the bot's Cardano address (not the owner's), then register it:");
    console.error(`  curl -X POST "${base}/api/v1/botAuth" -H "Content-Type: application/json" -d '{"botKeyId":"${config.botKeyId}","secret":"<from bot-config>","paymentAddress":"<bot-addr>"}'`);
    console.error("Then run this script again.");
    process.exit(1);
  }
  if (ownerAddress === botAddress) {
    console.error("The bot must have its own wallet and address, not the same as the owner.");
    console.error("Right now paymentAddress in bot-config.json is the same as the owner's address.");
    console.error("Set paymentAddress to a different Cardano address (a wallet the bot controls), then:");
    console.error("  1. POST /api/v1/botAuth with { botKeyId, secret, paymentAddress: '<bot-addr>' }");
    console.error("  2. Run this script again.");
    process.exit(1);
  }
  console.error("Owner:", ownerAddress, "| Bot:", botAddress);

  console.error("Creating 2-of-2 wallet (owner + bot)...");
  let result: { walletId: string; address: string; name: string };
  try {
    result = await createWallet(config.baseUrl, token, {
      name: "Me and Bot",
      description: "2-of-2 multisig created via bot API (owner + bot)",
      signersAddresses: [ownerAddress, botAddress],
      signersDescriptions: ["Owner", "Bot"],
      numRequiredSigners: 2,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("index 1") || msg.includes("Invalid payment address")) {
      console.error("");
      console.error("The bot's payment address in bot-config.json is not a valid Cardano address.");
      console.error("Do this:");
      console.error("  1. Set paymentAddress in bot-config.json to a real address (the bot's wallet).");
      console.error("  2. Register it once: POST /api/v1/botAuth with { botKeyId, secret, paymentAddress }.");
      console.error("  3. Run this script again.");
    }
    throw err;
  }

  console.log(JSON.stringify(result, null, 2));
  console.error("Done. Wallet ID:", result.walletId, "Address:", result.address);

  console.error("Owner info:");
  try {
    const ownerInfo = await getOwnerInfo(config.baseUrl, token, result.walletId);
    console.log(JSON.stringify(ownerInfo, null, 2));
  } catch (e) {
    console.error("(ownerInfo failed:", (e as Error).message + ")");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
