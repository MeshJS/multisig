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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  NativeScript,
  resolvePaymentKeyHash,
  serializeNativeScript,
} from "@meshsdk/core";
import { PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import { stakeCredentialHash } from "@/data/cardano";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function PageNewWallet() {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(0);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();
  const [nativeScriptType, setNativeScriptType] = useState<
    "all" | "any" | "atLeast"
  >("atLeast");
  const [stakeKey, setStakeKey] = useState<string>(stakeCredentialHash);
  const pathIsWalletInvite = router.pathname == "/wallets/new-wallet/[id]";
  const walletInviteId = pathIsWalletInvite
    ? (router.query.id as string)
    : undefined;

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
    if (userAddress === undefined) return;
    setSignerAddresses([userAddress, ""]);
    setSignerDescriptions(["", ""]);
  }, [userAddress]);

  useEffect(() => {
    if (pathIsWalletInvite && walletInvite) {
      setName(walletInvite.name);
      setDescription(walletInvite.description ?? "");
      setSignerAddresses(walletInvite.signersAddresses);
      setSignerDescriptions(walletInvite.signersDescriptions);
    }
  }, [pathIsWalletInvite, walletInvite]);

  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
  }

  function createNativeScript() {
    setLoading(true);

    const keyHashes = [];
    for (let i = 0; i < signersAddresses.length; i++) {
      const addr = signersAddresses[i] as string;
      const walletKeyHash = resolvePaymentKeyHash(addr);
      keyHashes.push(walletKeyHash);
    }

    const nativeScript: {
      type: "all" | "any" | "atLeast";
      scripts: { type: string; keyHash: string }[];
      required?: number;
    } = {
      type: nativeScriptType,
      scripts: keyHashes.map((keyHash) => ({
        type: "sig",
        keyHash,
      })),
    };

    if (nativeScriptType == "atLeast") {
      nativeScript.required = numRequiredSigners;
    }

    const { scriptCbor } = serializeNativeScript(nativeScript as NativeScript);

    if (scriptCbor === undefined) throw new Error("scriptCbor is undefined");

    createWallet({
      name: name,
      description: description,
      signersAddresses: signersAddresses,
      signersDescriptions: signersDescriptions,
      numRequiredSigners: numRequiredSigners,
      scriptCbor: scriptCbor,
      stakeCredentialHash: stakeKey,
      type: nativeScriptType,
    });
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
        signersDescriptions: signersDescriptions,
      });
    }
  }

  return (
    <>
      <PageHeader
        pageTitle={`New Wallet${pathIsWalletInvite && walletInvite ? `: ${walletInvite.name}` : ""}`}
      ></PageHeader>
      {user && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Wallet Info</CardTitle>
              <CardDescription>
                Some information to help you remember what is this wallet use
                for
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
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    className="min-h-32"
                    placeholder="For managing Fund12 Project X catalyst fund / dRep for team X / Company X main spending wallet"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div></div>

          <Card>
            <CardHeader>
              <CardTitle>Signers</CardTitle>
              <CardDescription>
                Add the addresses of the signers who will be required to approve
                transactions in this wallet. The first address is your address
                and will be automatically added. You can add more signers by
                clicking the "Add Signers" button. You can also remove a signer
                by clicking the "Remove" button next to the signer's address.
                The number of required signers is the number of signers required
                to approve a transaction to make it valid. Alternatively, you
                can save this wallet and create a link to invite signers with
                the "Invite Signers" button.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div>
                  {pathIsWalletInvite ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `https://multisig.meshjs.dev/wallets/invite/${walletInviteId}`,
                        );
                        toast({
                          title: "Copied invite link",
                          description: "Invite link copied to clipboard",
                          duration: 5000,
                        });
                      }}
                      className="m-0 h-auto max-w-full justify-start truncate p-0"
                    >
                      Invite signers:
                      https://multisig.meshjs.dev/wallets/invite/
                      {walletInviteId}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleCreateNewWallet()}
                      disabled={loading}
                    >
                      Invite Signers
                    </Button>
                  )}
                </div>

                <div className="grid gap-3">
                  <Table>
                    <TableBody>
                      {signersAddresses.map((signer, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <div className="grid gap-4 py-4">
                              <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Address</Label>
                                <Input
                                  type="string"
                                  placeholder="addr1..."
                                  className={`col-span-3 ${
                                    signersAddresses[index] != "" &&
                                    !checkValidAddress(
                                      signersAddresses[index]!,
                                    ) &&
                                    "text-red-500"
                                  }`}
                                  value={signer}
                                  onChange={(e) => {
                                    const newSigners = [...signersAddresses];
                                    newSigners[index] = e.target.value;
                                    setSignerAddresses(newSigners);
                                  }}
                                  disabled={index === 0}
                                />
                              </div>
                              <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">
                                  Description
                                </Label>
                                <Input
                                  className="col-span-3"
                                  value={signersDescriptions[index]}
                                  onChange={(e) => {
                                    const newSigners = [...signersDescriptions];
                                    newSigners[index] = e.target.value;
                                    setSignerDescriptions(newSigners);
                                  }}
                                  placeholder="optional name or description of this signer"
                                />
                              </div>

                              {signersAddresses.filter(
                                (signer) => signer === signersAddresses[index],
                              ).length > 1 && (
                                <p className="text-red-500">
                                  This address is duplicated with another signer
                                </p>
                              )}
                              {!checkValidAddress(signersAddresses[index]!) &&
                                signersAddresses[index] != "" && (
                                  <p className="text-red-500">
                                    This address is is invalid
                                  </p>
                                )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {index > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1"
                                onClick={() => {
                                  const newSigners = [...signersAddresses];
                                  newSigners.splice(index, 1);
                                  setSignerAddresses(newSigners);

                                  const newSignersDesc = [
                                    ...signersDescriptions,
                                  ];
                                  newSignersDesc.splice(index, 1);
                                  setSignerDescriptions(newSignersDesc);
                                }}
                                disabled={index === 0}
                              >
                                Remove
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}

                      <TableRow>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => addSigner()}
                          >
                            <PlusCircle className="h-3.5 w-3.5" />
                            Add Signers
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="description">
                    Number of required signers
                  </Label>
                  {nativeScriptType == "atLeast" ? (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      disabled={nativeScriptType != "atLeast"}
                    >
                      {signersAddresses.length > 0 &&
                        Array.from(
                          { length: signersAddresses.length },
                          (_, i) => i + 1,
                        ).map((num) => (
                          <ToggleGroupItem
                            key={num}
                            value={num.toString()}
                            onClick={() => {
                              if (numRequiredSigners == num) {
                                setNumRequiredSigners(0);
                              } else {
                                setNumRequiredSigners(num);
                              }
                            }}
                          >
                            {num}
                          </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                  ) : (
                    <p>
                      <b>
                        {nativeScriptType == "all"
                          ? "All signers are"
                          : "Any one signer is"}
                      </b>
                      required to approve transactions in this wallet.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div></div>

          <Card>
            <CardHeader>
              <CardTitle>Advance Options</CardTitle>
              <CardDescription>
                Customize your wallet with advance options, only if you know
                what you are doing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="stakeKey">Stake Credential Hash</Label>
                  <Input
                    id="name"
                    type="text"
                    className="w-full"
                    value={stakeKey}
                    onChange={(e) => setStakeKey(e.target.value)}
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="type">Native Script Type</Label>
                  <Select
                    value={nativeScriptType}
                    onValueChange={(value) =>
                      setNativeScriptType(value as "all" | "any" | "atLeast")
                    }
                    defaultValue={"atLeast"}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="atLeast">
                          At Least - the number of participants required to sign
                          a transaction to make it valid
                        </SelectItem>
                        <SelectItem value="all">
                          All - every participants need to sign to make a
                          transaction valid
                        </SelectItem>
                        <SelectItem value="any">
                          Any - any participants can sign to make a transaction
                          valid
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div></div>

          <div className="flex gap-4">
            <Button
              onClick={createNativeScript}
              disabled={
                signersAddresses.length == 0 ||
                signersAddresses.some((signer) => !checkValidAddress(signer)) ||
                (nativeScriptType == "atLeast" && numRequiredSigners == 0) ||
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
              <Button
                onClick={() => handleCreateNewWallet()}
                disabled={loading}
              >
                Save Wallet and Invite Signers
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
