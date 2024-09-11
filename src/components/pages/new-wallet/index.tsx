import RootLayout from "@/components/common/layout";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default function PageNewWallet() {
  const [signers, setSigners] = useState<string[]>([]);
  const [numSigners, setNumSigners] = useState<number>(0);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(0);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: async () => {
      console.log("Wallet created");
    },
    onError: (e) => {
      console.error(e);
    },
  });

  useEffect(() => {
    if (userAddress === undefined) return;
    setSigners([userAddress, ""]);
    setNumSigners(2);
  }, [userAddress]);

  function addSigner() {
    setSigners([...signers, ""]);
    setNumSigners(signers.length + 1);
  }

  function createNativeScript() {
    const keyHashes = [];
    for (let i = 0; i < signers.length; i++) {
      const addr = signers[i] as string;
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
      signers: signers,
      numberOfSigners: numRequiredSigners,
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
    <RootLayout>
      <PageHeader pageTitle="New Wallet"></PageHeader>

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
                  <Label htmlFor="name">Signers' Addresses</Label>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {signers.map((signer, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Input
                              type="string"
                              placeholder="addr1..."
                              value={signer}
                              onChange={(e) => {
                                const newSigners = [...signers];
                                newSigners[index] = e.target.value;
                                setSigners(newSigners);
                              }}
                              disabled={index === 0}
                            />
                            {/* add a error message */}
                            {signers[index] != "" &&
                              !checkValidAddress(signers[index]!) && (
                                <div className="text-sm text-red-500">
                                  Invalid Address
                                </div>
                              )}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1"
                              onClick={() => {
                                const newSigners = [...signers];
                                newSigners.splice(index, 1);
                                setSigners(newSigners);
                                setNumSigners(signers.length - 1);
                              }}
                              disabled={index === 0}
                            >
                              Remove
                            </Button>
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
                  <ToggleGroup type="single" defaultValue="s" variant="outline">
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
              signers.length == 0 ||
              signers.some((signer) => !checkValidAddress(signer)) ||
              numRequiredSigners == 0 ||
              name.length == 0
            }
          >
            Create Wallet
          </Button>
        </div>
      </div>
    </RootLayout>
  );
}
