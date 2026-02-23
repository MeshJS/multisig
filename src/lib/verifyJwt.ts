import { verify } from "jsonwebtoken";

export type JwtPayload =
  | { address: string; botId?: undefined; type?: undefined }
  | { address: string; botId: string; type: "bot" };

export function verifyJwt(token: string): JwtPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");

  try {
    const payload = verify(token, secret) as {
      address: string;
      botId?: string;
      type?: "bot";
    };
    if (!payload || typeof payload.address !== "string") return null;
    return payload as JwtPayload;
  } catch (err) {
    return null;
  }
}

/** True if the verified payload is a bot session. */
export function isBotJwt(payload: JwtPayload): payload is { address: string; botId: string; type: "bot" } {
  return payload.type === "bot" && typeof (payload as { botId?: string }).botId === "string";
}