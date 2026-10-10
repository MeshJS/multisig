import { createHmac } from "crypto";

export function hashBotSecret(secret: string, jwtSecret: string): string {
  return createHmac("sha256", jwtSecret).update(secret, "utf8").digest("hex");
}
