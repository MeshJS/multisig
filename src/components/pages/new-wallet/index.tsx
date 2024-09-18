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

export default function PageNewWallet() {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescription] = useState<string[]>([]);
  const [numSigners, setNumSigners] = useState<number>(0);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(0);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: async () => {
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

  useEffect(() => {
    if (userAddress === undefined) return;
    setSignerAddresses([userAddress, ""]);
    setNumSigners(2);
  }, [userAddress]);

  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescription([...signersDescriptions, ""]);
    setNumSigners(signersAddresses.length + 1);
  }

  function createNativeScript() {
    setLoading(true);

    const keyHashes = [];
    for (let i = 0; i < signersAddresses.length; i++) {
      const addr = signersAddresses[i] as string;
      const walletKeyHash = resolvePaymentKeyHash(addr);
      keyHashes.push(walletKeyHash);
    }

    const nativeScript: NativeScript = {
      type: "atLeast",
      required: numRequiredSigners,
      scripts: keyHashes.map((keyHash) => ({
        type: "sig",
        keyHash,
      })),
    };

    const { scriptCbor } = serializeNativeScript(nativeScript);

    if (scriptCbor === undefined) throw new Error("scriptCbor is undefined");

    createWallet({
      name: name,
      description: description,
      signersAddresses: signersAddresses,
      signersDescriptions: signersDescriptions,
      numRequiredSigners: numRequiredSigners,
      scriptCbor: scriptCbor,
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

  return (
    <>
      <PageHeader pageTitle="New Wallet"></PageHeader>
      {user && (
        <div className="grid grid-cols-2 gap-4">
          <div>
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
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Signers</CardTitle>
                <CardDescription>
                  Add required signers to approve transactions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6">
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
                                      const newSigners = [
                                        ...signersDescriptions,
                                      ];
                                      newSigners[index] = e.target.value;
                                      setSignerDescription(newSigners);
                                    }}
                                    placeholder="optional name or description of this signer"
                                  />
                                </div>
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
                                    setSignerDescription(newSignersDesc);

                                    setNumSigners(signersAddresses.length - 1);
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
                    <ToggleGroup
                      type="single"
                      defaultValue="s"
                      variant="outline"
                    >
                      {numSigners > 0 &&
                        Array.from({ length: numSigners }, (_, i) => i + 1).map(
                          (num) => (
                            <ToggleGroupItem
                              key={num}
                              value={num.toString()}
                              onClick={() => setNumRequiredSigners(num)}
                            >
                              {num}
                            </ToggleGroupItem>
                          ),
                        )}
                    </ToggleGroup>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Button
              onClick={createNativeScript}
              disabled={
                signersAddresses.length == 0 ||
                signersAddresses.some((signer) => !checkValidAddress(signer)) ||
                numRequiredSigners == 0 ||
                name.length == 0 ||
                loading
              }
            >
              {loading ? "Creating Wallet..." : "Create Wallet"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
