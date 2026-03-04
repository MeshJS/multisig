import { timingSafeEqual } from "crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  generateBotKeySecret,
  hashBotKeySecret,
  sha256,
  BOT_SCOPES,
  type BotScope,
} from "@/lib/auth/botKey";

const MAX_CLAIM_ATTEMPTS = 3;

export class ClaimError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

export interface ClaimBotInput {
  pendingBotId: string;
  claimCode: string;
  approvedScopes?: BotScope[] | null;
  ownerAddress: string;
}

export interface ClaimBotResult {
  botKeyId: string;
  botId: string;
  name: string;
  scopes: BotScope[];
}

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Core claim logic shared between the REST endpoint and tRPC procedure.
 * Must be called within a Prisma transaction (or with a transaction client).
 */
export async function performClaim(
  tx: TxClient,
  input: ClaimBotInput,
): Promise<ClaimBotResult> {
  const { pendingBotId, claimCode, approvedScopes, ownerAddress } = input;
  const incomingHash = sha256(claimCode);

  // Load PendingBot
  const pendingBot = await tx.pendingBot.findUnique({
    where: { id: pendingBotId },
    include: { claimToken: true },
  });

  if (!pendingBot) {
    throw new ClaimError(404, "bot_not_found", "Bot not found or registration expired");
  }

  if (pendingBot.status === "CLAIMED") {
    throw new ClaimError(409, "bot_already_claimed", "This bot has already been claimed");
  }

  if (pendingBot.expiresAt < new Date()) {
    throw new ClaimError(409, "invalid_or_expired_claim_code", "Registration has expired");
  }

  const claimToken = pendingBot.claimToken;
  if (!claimToken || claimToken.consumedAt) {
    throw new ClaimError(409, "invalid_or_expired_claim_code", "Claim token not found or already consumed");
  }

  if (claimToken.expiresAt < new Date()) {
    throw new ClaimError(409, "invalid_or_expired_claim_code", "Claim code has expired");
  }

  if (claimToken.attempts >= MAX_CLAIM_ATTEMPTS) {
    throw new ClaimError(409, "claim_locked_out", "Too many failed attempts. Ask the bot to re-register.");
  }

  // Constant-time hash comparison
  const storedBuf = Buffer.from(claimToken.tokenHash, "hex");
  const incomingBuf = Buffer.from(incomingHash, "hex");

  let hashMatch = false;
  if (storedBuf.length === incomingBuf.length) {
    hashMatch = timingSafeEqual(storedBuf, incomingBuf);
  }

  if (!hashMatch) {
    await tx.botClaimToken.update({
      where: { id: claimToken.id },
      data: { attempts: claimToken.attempts + 1 },
    });
    throw new ClaimError(409, "invalid_or_expired_claim_code", "Invalid claim code");
  }

  // Parse requested scopes
  const requestedScopes = JSON.parse(pendingBot.requestedScopes) as BotScope[];

  // Determine final scopes — default to requested if not narrowed
  const scopes = approvedScopes ?? requestedScopes;

  // Validate approvedScopes is a subset of requestedScopes
  const invalidScopes = scopes.filter((s) => !requestedScopes.includes(s));
  if (invalidScopes.length > 0) {
    throw new ClaimError(400, "invalid_claim_payload", "approvedScopes must be a subset of requestedScopes");
  }

  // Generate secret and create BotKey + BotUser
  const secret = generateBotKeySecret();
  const keyHash = hashBotKeySecret(secret);

  const botKey = await tx.botKey.create({
    data: {
      ownerAddress,
      name: pendingBot.name,
      keyHash,
      scope: JSON.stringify(scopes),
    },
  });

  const botUser = await tx.botUser.create({
    data: {
      botKeyId: botKey.id,
      paymentAddress: pendingBot.paymentAddress,
      stakeAddress: pendingBot.stakeAddress,
      displayName: pendingBot.name,
    },
  });

  // Update PendingBot
  await tx.pendingBot.update({
    where: { id: pendingBotId },
    data: {
      status: "CLAIMED",
      claimedBy: ownerAddress,
      secretCipher: secret, // Store plain secret for one-time pickup
    },
  });

  // Mark claim token consumed
  await tx.botClaimToken.update({
    where: { id: claimToken.id },
    data: { consumedAt: new Date() },
  });

  return {
    botKeyId: botKey.id,
    botId: botUser.id,
    name: pendingBot.name,
    scopes,
  };
}
