import React from "react";
import { getFirstAndLast } from "@/utils/strings";
import {
    resolvePaymentKeyHash,
    resolveStakeKeyHash,
  } from "@meshsdk/core";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PlusCircle } from "lucide-react";


// Define the prop type for signerConfig
interface SignerConfig {
  signersAddresses: string[];
  setSignerAddresses: React.Dispatch<React.SetStateAction<string[]>>;
  signersDescriptions: string[];
  setSignerDescriptions: React.Dispatch<React.SetStateAction<string[]>>;
  signersStakeKeys: string[];
  setSignerStakeKeys: React.Dispatch<React.SetStateAction<string[]>>;
  numRequiredSigners: number;
  setNumRequiredSigners: React.Dispatch<React.SetStateAction<number>>;
  addSigner: () => void;
  pathIsWalletInvite: boolean;
  walletInviteId?: string;
  nativeScriptType: "all" | "any" | "atLeast";
  toast: (options: {
    title: string;
    description?: string;
    duration?: number;
  }) => void;
  handleCreateNewWallet: () => void;
  loading: boolean;
}

interface NWSignersCardProps {
  signerConfig: SignerConfig;
}

const NWSignersCard: React.FC<NWSignersCardProps> = ({ signerConfig }) => {
  const {
    signersAddresses,
    setSignerAddresses,
    signersDescriptions,
    setSignerDescriptions,
    signersStakeKeys = [], // default to empty array
    setSignerStakeKeys,
    numRequiredSigners,
    setNumRequiredSigners,
    addSigner,
    pathIsWalletInvite,
    walletInviteId,
    nativeScriptType,
    toast,
    handleCreateNewWallet,
    loading,
  } = signerConfig;

  function checkValidAddress(address: string) {
    try {
      resolvePaymentKeyHash(address);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  function checkValidStakeKey(stakeKey: string){
    try{
      resolveStakeKeyHash(stakeKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signers</CardTitle>
        <CardDescription className="whitespace-pre-line">
          {`Add the addresses of the signers who will be required to approve transactions in this wallet. The first address is your address which is automatically added. 
                The number of required signers is the number of signers required to approve a transaction to make it valid. You can:
                • add more signers by clicking the "Add Signers" button. 
                • remove a signer by clicking the "Remove" button next to the signer's address.
                • save this wallet and create a link to invite signers with the "Invite Signers" button.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          {/* Invite Signers */}
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
                Invite signers: https://multisig.meshjs.dev/wallets/invite/
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
          {/* Table of Signers */}
          <div className="grid gap-4">
            <Table>
              <TableBody>
                {signersAddresses.map((signer, index) => (
                  <TableRow key={index}>
                    <TableCell className="w-full">
                      <div className="grid gap-3">
                        <div className="grid grid-cols-4 items-center gap-2">
                          <Label className="text-right">Address</Label>
                          <Input
                            className={`col-span-3 ${signer && !checkValidAddress(signer) ? "border-red-500" : ""}`}
                            placeholder="addr1..."
                            value={
                              !signer ? "" : getFirstAndLast(signer, 15, 10)
                            }
                            onChange={(e) => {
                              const updated = [...signersAddresses];
                              updated[index] = e.target.value;
                              setSignerAddresses(updated);
                            }}
                            disabled={index === 0}
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-2">
                          <Label className="text-right">Stake Key</Label>
                          <Input
                            className={`col-span-3 ${signersStakeKeys[index] && checkValidStakeKey(signersStakeKeys[index]) ? "border-red-500" : ""}`}
                            placeholder="stake1..."
                            // optional chaining and nullish coalescing
                            value={
                              !signersStakeKeys?.[index]
                                ? ""
                                : getFirstAndLast(
                                    signersStakeKeys?.[index],
                                    15,
                                    10,
                                  )
                            }
                            onChange={(e) => {
                              // start from current or empty
                              const updated = [...signersStakeKeys];
                              updated[index] = e.target.value;
                              setSignerStakeKeys(updated);
                            }}
                            disabled={index === 0}
                          />
                        </div>
                        {signersStakeKeys[index] &&
                          !checkValidAddress(signersStakeKeys[index]) && (
                            <p className="ml-4 text-sm text-red-500">
                              Invalid stake key format.
                            </p>
                          )}

                        <div className="grid grid-cols-4 items-center gap-2">
                          <Label className="text-right">Description</Label>
                          <Input
                            className="col-span-3"
                            placeholder="optional name or description"
                            value={signersDescriptions[index]}
                            onChange={(e) => {
                              const updated = [...signersDescriptions];
                              updated[index] = e.target.value;
                              setSignerDescriptions(updated);
                            }}
                          />
                        </div>

                        {/* Validation Messages */}
                        {signer && !checkValidAddress(signer) && (
                          <p className="ml-4 text-sm text-red-500">
                            Invalid address format.
                          </p>
                        )}
                        {signersAddresses.filter((addr) => addr === signer)
                          .length > 1 && (
                          <p className="ml-4 text-sm text-red-500">
                            This address is duplicated.
                          </p>
                        )}
                      </div>
                    </TableCell>

                    {/* Remove Signer Button */}
                    <TableCell className="text-right align-top">
                      {index > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const updatedAddresses = [...signersAddresses];
                            updatedAddresses.splice(index, 1);
                            setSignerAddresses(updatedAddresses);

                            const updatedDescriptions = [
                              ...signersDescriptions,
                            ];
                            updatedDescriptions.splice(index, 1);
                            setSignerDescriptions(updatedDescriptions);

                            const updatedStakeKeys = [...signersStakeKeys];
                            updatedStakeKeys.splice(index, 1);
                            setSignerStakeKeys(updatedStakeKeys);
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}

                {/* Add Signer Row */}
                <TableRow>
                  <TableCell colSpan={2}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addSigner}
                      className="w-full"
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add Signer
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Required Signers */}
          <div className="grid gap-3">
            <Label>Required Signers</Label>

            {nativeScriptType === "atLeast" ? (
              <>
                <p className="text-sm text-gray-500">
                  How many participants must sign to approve transactions.
                </p>
                <ToggleGroup
                  type="single"
                  value={numRequiredSigners.toString()}
                  onValueChange={(v) => {
                    if (v) setNumRequiredSigners(Number(v));
                  }}
                  className="mt-2"
                >
                  {Array.from(
                    { length: signersAddresses.length },
                    (_, i) => i + 1,
                  ).map((num) => (
                    <ToggleGroupItem key={num} value={num.toString()}>
                      {num}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-sm">
                  Selected: {numRequiredSigners} of {signersAddresses.length}{" "}
                  signer(s).
                </p>
              </>
            ) : (
              <p className="text-sm">
                {nativeScriptType === "all"
                  ? "All signers must approve."
                  : "Any signer can approve."}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NWSignersCard;
