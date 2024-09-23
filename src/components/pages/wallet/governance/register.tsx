import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/common/card-content";
import {
  getFile,
  hashDrepAnchor,
  keepRelevant,
  Quantity,
  Unit,
} from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import useAppWallet from "@/hooks/useAppWallet";

export default function CardRegister() {
  const { appWallet } = useAppWallet();

  const { toast } = useToast();
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);

  const [givenName, setgivenName] = useState<string>("");
  const [motivations, setmotivations] = useState<string>("");
  const [objectives, setobjectives] = useState<string>("");
  const [qualifications, setqualifications] = useState<string>("");
  const [links, setlinks] = useState<string>("");
  const [identity, setidentity] = useState<string>("");

  const { mutate: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        setLoading(false);
        toast({
          title: "Transaction Created",
          description: "DRep registration transaction has been created",
          duration: 5000,
        });
        setgivenName("");
        setmotivations("");
        setobjectives("");
        setqualifications("");
        setlinks("");
        setidentity("");
        void ctx.transaction.getPendingTransactions.invalidate();
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  async function createAnchor() {
    const rawResponse = await fetch("/api/vercel-storage/put", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname: `drep/${givenName}.jsonld`,
        value: JSON.stringify({
          "@context": {
            CIP100:
              "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
            CIP119:
              "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
            hashAlgorithm: "CIP100:hashAlgorithm",
            body: {
              "@id": "CIP119:body",
              "@context": {
                references: {
                  "@id": "CIP119:references",
                  "@container": "@set",
                  "@context": {
                    GovernanceMetadata: "CIP100:GovernanceMetadataReference",
                    Identity: "CIP119:IdentityReference",
                    Link: "CIP119:LinkReference",
                    Other: "CIP100:OtherReference",
                    label: "CIP100:reference-label",
                    uri: "CIP100:reference-uri",
                    referenceHash: {
                      "@id": "CIP119:referenceHash",
                      "@context": {
                        hashDigest: "CIP119:hashDigest",
                        hashAlgorithm: "CIP100:hashAlgorithm",
                      },
                    },
                  },
                },
                paymentAddress: "CIP119:paymentAddress",
                givenName: "CIP119:givenName",
                image: "CIP119:image",
                objectives: "CIP119:objectives",
                motivations: "CIP119:motivations",
                qualifications: "CIP119:qualifications",
                doNotList: "CIP119:doNotList",
              },
            },
            authors: {
              "@id": "CIP100:authors",
              "@container": "@set",
              "@context": {
                name: "http://xmlns.com/foaf/0.1/name",
                witness: {
                  "@id": "CIP100:witness",
                  "@context": {
                    witnessAlgorithm: "CIP100:witnessAlgorithm",
                    publicKey: "CIP100:publicKey",
                    signature: "CIP100:signature",
                  },
                },
              },
            },
          },
          authors: [],
          hashAlgorithm: "blake2b-256",
          body: {
            doNotList: false,
            givenName: givenName,
            motivations: motivations,
            objectives: objectives,
            paymentAddress: appWallet?.address,
            qualifications: qualifications,
            references: [
              {
                "@type": "Link",
                label: "Link",
                uri: links,
              },
              {
                "@type": "Identity",
                label: "Identity",
                uri: identity,
              },
            ],
          },
        }),
      }),
    });
    const res = await rawResponse.json();

    const anchorUrl = res.url;
    const anchorObj = JSON.parse(getFile(anchorUrl));
    const anchorHash = hashDrepAnchor(anchorObj);

    return { anchorUrl, anchorHash };
  }

  async function registerDrep() {
    if (!connected) throw new Error("Not connected to wallet");
    if (!userAddress) throw new Error("No user address");
    if (!appWallet) throw new Error("No wallet");

    setLoading(true);
    const registrationFee = "500000000";

    const blockchainProvider = getProvider(network);

    const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);
    const assetMap = new Map<Unit, Quantity>();
    assetMap.set("lovelace", registrationFee);
    const selectedUtxos = keepRelevant(assetMap, utxos);
    if (selectedUtxos.length === 0) throw new Error("No relevant UTxOs found");

    const { anchorUrl, anchorHash } = await createAnchor();

    // tx

    const txBuilder = getTxBuilder(network);

    for (const utxo of selectedUtxos) {
      txBuilder
        .txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        )
        .txInScript(appWallet.scriptCbor);
    }

    txBuilder
      .drepRegistrationCertificate(appWallet.dRepId, {
        anchorUrl: anchorUrl,
        anchorDataHash: anchorHash,
      })
      .certificateScript(appWallet.scriptCbor)
      .changeAddress(appWallet.address)
      .selectUtxosFrom(selectedUtxos);

    const unsignedTx = await txBuilder.complete();

    const signedTx = await wallet.signTx(unsignedTx, true);

    const signedAddresses = [];
    signedAddresses.push(userAddress);

    let txHash = undefined;
    let state = 0;
    if (appWallet.numRequiredSigners == signedAddresses.length) {
      state = 1;
      txHash = await wallet.submitTx(signedTx);
    }

    createTransaction({
      walletId: appWallet.id,
      txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
      txCbor: signedTx,
      signedAddresses: [userAddress],
      state: state,
      description: "DRep registration",
      txHash: txHash,
    });
  }

  return (
    <CardUI title="Register for DRep" icon={Plus} cardClassName="col-span-2">
      <div className="flex flex-col gap-4">
        <p>
          A DRep is expected to actively participate in governance and act as a
          representative of other Cardano members in governance matters.
          Therefore, DReps will be expected to keep abreast of Governance
          Actions so they can make informed and wise decisions. Becoming a DRep
          will require a refundable deposit of ₳500.{" "}
          <Link
            href="https://docs.gov.tools/about/what-is-cardano-govtool/govtool-functions/dreps"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn about
          </Link>{" "}
          about DRep.
        </p>

        <fieldset className="grid gap-6">
          <div className="grid gap-3">
            <Label>
              DRep Name - This is the name that will be shown on your DRep
              profile
            </Label>
            <Input
              placeholder="e.g. MeshJS"
              value={givenName}
              onChange={(e) => {
                const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                setgivenName(value);
              }}
            />
          </div>
          <div className="grid gap-3">
            <Label>
              Objectives - What you believe and what you want to achieve as a
              DRep.
            </Label>
            <Textarea
              value={objectives}
              onChange={(e) => setobjectives(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Motivations - Why do you want to be a DRep, what personal and
              professional experiences do you want to share.
            </Label>
            <Textarea
              value={motivations}
              onChange={(e) => setmotivations(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Qualifications - List any qualifications that are relevant to your
              role as a DRep
            </Label>
            <Textarea
              value={qualifications}
              onChange={(e) => setqualifications(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Link - A link to social media or any other web URL that gives a
              fuller picture of who you are, what you stand for, and why.
            </Label>
            <Input
              value={links}
              onChange={(e) => setlinks(e.target.value)}
              placeholder="https://path/to/info"
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Identity - A link to prove you are who you say you are. Ideally,
              you will provide a link to a place that shows your DRep ID
              clearly.
            </Label>
            <Input
              placeholder="https://path/to/identity"
              value={identity}
              onChange={(e) => setidentity(e.target.value)}
            />
          </div>
        </fieldset>

        <div>
          <Button onClick={() => registerDrep()} disabled={loading}>
            {loading ? "Loading..." : "Register DRep"}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}
