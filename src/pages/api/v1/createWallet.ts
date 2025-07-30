import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors } from "@/lib/cors";
import { MultisigKey, MultisigWallet } from "@/utils/multisigSDK";
import { deserializeAddress } from "@meshsdk/core";
import { deserializeNativeScript } from "@meshsdk/core-csl";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const {
    name,
    description,
    signersAddresses,
    signersStakeKeys,
    paymentScript,
    stakeScript,
    walletAddress,
  } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing required field name!" });
  }

  if (!paymentScript) {
    return res
      .status(400)
      .json({ error: "Missing required field paymentScript!" });
  }
  // db lookup for scriptCbor == paymentScript
  const existingWallet = await db.wallet.findFirst({
    where: {
      scriptCbor: paymentScript,
    },
  });
  if (existingWallet) {
    return res.status(409).json({
      error: "A wallet with this script already exists.",
    });
  }

  let paymentScriptJson, stakeScriptJson;
  try {
    paymentScriptJson = deserializeNativeScript(paymentScript).to_json();
    stakeScriptJson = deserializeNativeScript(stakeScript).to_json();
  } catch (e) {
    return res.status(400).json({ error: "Invalid script CBOR." });
  }
  console.log("Payment Script JSON:", paymentScriptJson);
  console.log("Stake Script JSON:", stakeScriptJson);
  let keys: MultisigKey[] = [];
  //If there are signersAddresses deserialize and match with the keys from the scripts

  if (Array.isArray(signersAddresses) && signersAddresses.length > 0) {
    signersAddresses.forEach((address: string, index: number) => {
      const dA = deserializeAddress(address);
      console.log("Deserialized Address:", dA);
    });
  }

  try {
    // const newWallet = await db.wallet.create({
    //   data: {
    //     name,
    //     description: description || "",
    //     signersAddresses,
    //     signersStakeKeys,
    //     signersDescriptions,
    //     numRequiredSigners,
    //     verified: verified ?? [],
    //     scriptCbor,
    //     type,
    //     isArchived: false,
    //   },
    // });
    res.status(201); //.json(newWallet);
  } catch (error) {
    console.error("Error creating wallet:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
