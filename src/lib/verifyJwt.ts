import { verify } from "jsonwebtoken";

export function verifyJwt(token: string): { address: string } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");

  try {
    const payload = verify(token, secret) as { address: string };
    return payload;
  } catch (err) {
    return null;
  }
}