import PageHeader from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolvePaymentKeyHash } from "@meshsdk/core";
import { useEffect, useState, useMemo } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import Signers from "./signers";
import ScriptSettings from "./scriptSettings";
import WalletComponent from "../invite/cip146/146Wallet";
import {
  getPubKeyHash,
  KeyObject,
  pubKeyToAddr,
} from "@/lib/helper/cip146/146sdk";
import {
  MultisigWallet,
  MultisigKey,
} from "@/lib/helper/cip146/multisigScriptSdk";
import { useSiteStore } from "@/lib/zustand/site";

export default function PageNewWallet() {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(1);
  const [selectedKeys, setSelectedKeys] = useState<KeyObject[]>([]);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();
  const network = useSiteStore((state) => state.network);
  const [MSWallet, setMSWallet] = useState<MultisigWallet | undefined>(
    undefined,
  );
  const pathIsWalletInvite = router.pathname == "/wallets/new-wallet/[id]";
  const walletInviteId = pathIsWalletInvite
    ? (router.query.id as string)
    : undefined;
  const [parsedSignersDescriptions, setParsedSignersDescriptions] = useState<
    Array<{
      original: string;
      parsed: Record<string, string> | null;
      isNew: boolean;
    }>
  >([]);

  const { mutate: deleteWalletInvite } = api.wallet.deleteNewWallet.useMutation(
    {
      onError: (e) => {
        console.error(e);
      },
    },
  );

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: async () => {
      if (pathIsWalletInvite) {
        deleteWalletInvite({ walletId: walletInviteId! });
      }
      setLoading(false);
      router.push("/wallets");
      toast({
        title: "Wallet Created",
        description: "Your wallet has been created",
        duration: 5000,
      });
    },
    onError: (e) => {
      setLoading(false);
      console.error(e);
    },
  });

  const { mutate: createNewWallet } = api.wallet.createNewWallet.useMutation({
    onSuccess: async (data) => {
      setLoading(false);
      router.push(`/wallets/new-wallet/${data.id}`);
      navigator.clipboard.writeText(
        `https://multisig.meshjs.dev/wallets/invite/${data.id}`,
      );
      toast({
        title: "Wallet Saved and invite link copied",
        description:
          "Your wallet has been saved and invite link copied in clipboard",
        duration: 5000,
      });
    },
    onError: (e) => {
      setLoading(false);
      console.error(e);
    },
  });

  const { mutate: updateNewWallet } = api.wallet.updateNewWallet.useMutation({
    onSuccess: async () => {
      setLoading(false);
      toast({
        title: "Wallet Info Updated",
        description: "Your wallet has been saved",
        duration: 5000,
      });
      router.push("/wallets");
    },
    onError: (e) => {
      setLoading(false);
      console.error(e);
    },
  });

  const { data: walletInvite } = api.wallet.getNewWallet.useQuery(
    { walletId: walletInviteId! },
    {
      enabled: pathIsWalletInvite && walletInviteId !== undefined,
    },
  );

  useEffect(() => {
    if (pathIsWalletInvite && walletInvite) {
      setName(walletInvite.name);
      setDescription(walletInvite.description ?? "");
      setSignerAddresses(walletInvite.signersAddresses);
      setSignerDescriptions(walletInvite.signersDescriptions);

      const parsedSD = walletInvite.signersDescriptions.map((desc: string) => {
        const trimmed = desc.trim();
        // Check that the description starts with "name:" and contains the required keys
        if (
          trimmed.startsWith("name:") &&
          trimmed.includes("key0:") &&
          trimmed.includes("key2:") &&
          trimmed.includes("key3:")
        ) {
          const parts = trimmed.split(";").filter(Boolean);
          const parsedObj: Record<string, string> = {};
          parts.forEach((part) => {
            const [k, ...rest] = part.split(":");
            if (k && rest) {
              parsedObj[k.trim()] = rest.join(":").trim();
            }
          });
          return { original: trimmed, parsed: parsedObj, isNew: true };
        }
        return { original: trimmed, parsed: null, isNew: false };
      });
      setParsedSignersDescriptions(parsedSD);
    }
  }, [pathIsWalletInvite, walletInvite]);

  // Update the useEffect that updates the combined description from selectedKeys
  useEffect(() => {
    if (selectedKeys.length > 0) {
      // Build a combined description using keys from indices 0, 2, and 3.
      // This ensures the admin key (index 0) and two additional keys (indices 2 and 3) are included.
      let combined = `name:${name};\n`;
      const indicesToInclude = [0, 2, 3];
      indicesToInclude.forEach((i) => {
        const key = selectedKeys[i];
        if (key) {
          const pubKeyHash = key.publicKey
            ? getPubKeyHash(key.publicKey)
            : "N/A";
          // Use a fixed role label based on the index (for clarity)
          let role = "";
          if (i === 0) role = "key0";
          else if (i === 2) role = "key2";
          else if (i === 3) role = "key3";
          else
            role =
              key.derivationPath.role !== undefined
                ? `key${key.derivationPath.role}`
                : "key?";
          combined += `${role}:${pubKeyHash};\n`;
        }
      });

      // Update the first entry in the signersDescriptions list
      setSignerDescriptions((prev) => {
        const newArr = [...prev];
        newArr[0] = combined;
        return newArr;
      });

      // Also update the parsed signers for the first entry using robust splitting and trimming.
      const parts = combined.split(";\n").filter(Boolean);
      const parsedObj: Record<string, string> = {};
      parts.forEach((part) => {
        const [k, ...rest] = part.split(":");
        if (k && rest) {
          parsedObj[k.trim()] = rest.join(":").trim();
        }
      });
      setParsedSignersDescriptions((prev) => {
        const newParsed = [...prev];
        newParsed[0] = { original: combined, parsed: parsedObj, isNew: true };
        return newParsed;
      });

      // Update the first entry in the signersAddresses list if applicable
      if (selectedKeys.length >= 3) {
        const parentAddr = pubKeyToAddr(
          selectedKeys[0]!,
          selectedKeys[2]!,
          false,
        );
        setSignerAddresses((prev) => {
          const newArr = [...prev];
          newArr[0] = parentAddr;
          return newArr;
        });
      } else if (user) {
        setSignerAddresses((prev) => {
          const newArr = [...prev];
          newArr[0] = userAddress || "";
          return newArr;
        });
      }
    }
  }, [selectedKeys, name, user, userAddress]);

  const scriptSettingsEnabled = useMemo(() => {
    const keys = keysHelper();
    return keys.some((k) => k.role === 0 && k.keyHash !== "");
  }, [signersAddresses, parsedSignersDescriptions]);

  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
  }

  function checkValidAddress(address: string) {
    try {
      resolvePaymentKeyHash(address);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function handleCreateNewWallet() {
    if (router.pathname == "/wallets/new-wallet") {
      setLoading(true);
      createNewWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        ownerAddress: userAddress!,
      });
    }
  }

  async function handleSaveWallet() {
    if (pathIsWalletInvite) {
      setLoading(true);
      updateNewWallet({
        walletId: walletInviteId!,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: getFinalSignersDescriptions(),
      });
    }
  }

  function getFinalSignersDescriptions() {
    return signersAddresses.map((_, index) => {
      const parsedObj = parsedSignersDescriptions[index];
      if (parsedObj && parsedObj.isNew && parsedObj.parsed) {
        const entries = Object.entries(parsedObj.parsed).map(([key, value]) => {
          if (key === "name") {
            return `name:${value}`;
          }
          return `${key}:${value}`;
        });
        return entries.join(";") + ";";
      }
      // Fallback: ensure a string is always returned
      return signersDescriptions[index] ?? "";
    });
  }

  function keysHelper(): MultisigKey[] {
    try {
      let keys: MultisigKey[] = [];
      if (parsedSignersDescriptions && parsedSignersDescriptions.length > 0) {
        parsedSignersDescriptions.forEach((desc) => {
          if (desc.parsed) {
            // For each property in the parsed object (except "name"), create a key object.
            Object.keys(desc.parsed).forEach((k) => {
              if (k !== "name") {
                const role = parseInt(k.replace("key", ""), 10);
                if (desc.parsed![k]) {
                  keys.push({
                    keyHash: desc.parsed![k],
                    role: role,
                    name: desc.parsed!.name || "",
                  });
                }
              }
            });
          }
        });
      }
      // If no role 0 keys were found, fallback to signersAddresses if available.
      if (keys.filter((key) => key.role === 0).length === 0) {
        if (signersAddresses.length === 0) {
          console.warn("No addresses provided to generate fallback keys.");
          return [];
        }
        keys = signersAddresses.map((address) => ({
          keyHash: resolvePaymentKeyHash(address) || "",
          role: 0,
          name: "payment",
        }));
      }
      // Filter out any keys with an empty keyHash
      return keys.filter((k) => k.keyHash !== "");
    } catch (error) {
      console.error("Error in keysHelper:", error);
      return [];
    }
  }

  const scriptPreview = useMemo(() => {
    // If no addresses are provided, skip script generation.
    if (signersAddresses.length === 0) {
      console.warn("No addresses provided. Script preview generation skipped.");
      return null;
    }
    try {
      let keys: MultisigKey[] = keysHelper();
      const hasRole0 = keys.some((k) => k.role === 0 && k.keyHash !== "");
      if (!hasRole0) {
        console.warn("No valid role 0 key found. Skipping script generation.");
        return null; // Skip generating the preview
      }
      const wallet = new MultisigWallet(
        name,
        keys,
        numRequiredSigners,
        network,
      );
      setMSWallet(wallet);
      const nativeScript = wallet.buildScript(0);
      const jsonMetadata = wallet.getJsonMetadata();
      const stakeCredentialHash = wallet.getStakeCredentialHash();
      const { address: scriptAddress, scriptCbor } = wallet.getScript();
      if (!scriptCbor) throw new Error("scriptCbor is undefined");
      return {
        nativeScript,
        scriptCbor,
        scriptAddress,
        jsonMetadata,
        stakeCredentialHash,
      };
    } catch (error) {
      console.error("Error generating script preview:", error);
      return null;
    }
  }, [
    signersAddresses,
    parsedSignersDescriptions,
    numRequiredSigners,
    network,
    name,
  ]);

  async function createNativeScript() {
    if (!MSWallet) {
      console.error("No multisig wallet built.");
      toast({
        title: "Error",
        description:
          "No valid multisig configuration found. Please check your addresses and descriptions.",
        duration: 5000,
      });
      return;
    }
    setLoading(true);
    try {
      const { scriptCbor } = MSWallet.getScript();
      const stakeKey = MSWallet.getStakeCredentialHash();
      if (!scriptCbor) throw new Error("scriptCbor is undefined");
      console.log("[Native Script] Serialized script CBOR:", scriptCbor);
      createWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: getFinalSignersDescriptions(),
        numRequiredSigners: numRequiredSigners,
        scriptCbor: scriptCbor,
        stakeCredentialHash: stakeKey.length > 0 ? stakeKey : undefined,
        type: "atLeast",
      });
    } catch (error) {
      console.error("Error creating native script:", error);
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        pageTitle={`New Wallet${pathIsWalletInvite && walletInvite ? `: ${walletInvite.name}` : ""}`}
      ></PageHeader>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Wallet Info</CardTitle>
            <CardDescription>
              Some information to help you remember what is this wallet use for
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <div className="grid gap-3">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  className="w-full"
                  placeholder="Fund12 Project X"
                  value={name}
                  onChange={(e) => {
                    if (e.target.value.length <= 64) setName(e.target.value);
                  }}
                />
                {name.length >= 64 && (
                  <p className="text-red-500">
                    Name should be less than 64 characters
                  </p>
                )}
              </div>
              <div className="grid gap-3">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  className="min-h-32"
                  placeholder="For managing Fund12 Project X catalyst fund / dRep for team X / Company X main spending wallet"
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= 256)
                      setDescription(e.target.value);
                  }}
                />
                {description.length >= 256 && (
                  <p className="text-red-500">
                    Description should be less than 256 characters
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <div />

        <WalletComponent
          onSelectChildKeys={(childKeys) => {
            setSelectedKeys(childKeys);
          }}
        />

        <div></div>

        <Signers
          pathIsWalletInvite={pathIsWalletInvite}
          walletInviteId={walletInviteId}
          loading={loading}
          signersAddresses={signersAddresses}
          setSignerAddresses={setSignerAddresses}
          signersDescriptions={signersDescriptions}
          setSignerDescriptions={setSignerDescriptions}
          parsedSignersDescriptions={parsedSignersDescriptions}
          setParsedSignersDescriptions={setParsedSignersDescriptions}
          checkValidAddress={checkValidAddress}
          addSigner={addSigner}
          handleCreateNewWallet={handleCreateNewWallet}
          toast={toast}
        />

        <div></div>

        <ScriptSettings
          numRequiredSigners={numRequiredSigners}
          setNumRequiredSigners={setNumRequiredSigners}
          signersAddresses={signersAddresses}
          scriptPreview={scriptPreview}
          enabled={scriptSettingsEnabled}
        />

        <div></div>

        <div className="flex gap-4">
          <Button
            onClick={createNativeScript}
            disabled={
              signersAddresses.length == 0 ||
              signersAddresses.some((signer) => !checkValidAddress(signer)) ||
              name.length == 0 ||
              loading
            }
          >
            {loading ? "Creating Wallet..." : "Create Wallet"}
          </Button>
          {pathIsWalletInvite ? (
            <Button onClick={() => handleSaveWallet()} disabled={loading}>
              {loading ? "Saving Wallet..." : "Save Wallet for Later"}
            </Button>
          ) : (
            <Button onClick={() => handleCreateNewWallet()} disabled={loading}>
              Save Wallet and Invite Signers
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
