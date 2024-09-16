import type { NextApiRequest, NextApiResponse } from "next";
import { put } from "@vercel/blob";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const pathname = req.body.pathname;
    const value = req.body.value;

    const response = await put(pathname, value, {
      access: "public",
      token: process.env.NEXT_PUBLIC_VERCEL_TOKEN,
    });

    res.status(200).json({ url: response.url });
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
