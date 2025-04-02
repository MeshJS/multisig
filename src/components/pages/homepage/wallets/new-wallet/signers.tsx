import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';

interface SignersProps {
  pathIsWalletInvite: boolean;
  walletInviteId?: string;
  loading: boolean;
  signersAddresses: string[];
  setSignerAddresses: React.Dispatch<React.SetStateAction<string[]>>;
  signersDescriptions: string[];
  setSignerDescriptions: React.Dispatch<React.SetStateAction<string[]>>;
  parsedSignersDescriptions: Array<{ original: string; parsed: Record<string, string> | null; isNew: boolean }>;
  setParsedSignersDescriptions: React.Dispatch<React.SetStateAction<Array<{ original: string; parsed: Record<string, string> | null; isNew: boolean }>>>;
  checkValidAddress: (address: string) => boolean;
  addSigner: () => void;
  handleCreateNewWallet: () => void;
  toast: (options: { title: string; description: string; duration?: number }) => void;
}

export default function Signers({
  pathIsWalletInvite,
  walletInviteId,
  loading,
  signersAddresses,
  setSignerAddresses,
  signersDescriptions,
  setSignerDescriptions,
  parsedSignersDescriptions,
  setParsedSignersDescriptions,
  checkValidAddress,
  addSigner,
  handleCreateNewWallet,
  toast
}: SignersProps) {
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
          <div>
            {pathIsWalletInvite ? (
              <Button
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(`https://multisig.meshjs.dev/wallets/invite/${walletInviteId}`);
                  toast({
                    title: "Copied invite link",
                    description: "Invite link copied to clipboard",
                    duration: 5000
                  });
                }}
                className="m-0 h-auto max-w-full justify-start truncate p-0"
              >
                Invite signers: https://multisig.meshjs.dev/wallets/invite/{walletInviteId}
              </Button>
            ) : (
              <Button onClick={handleCreateNewWallet} disabled={loading}>
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
                            className={`col-span-3 ${signer !== '' && !checkValidAddress(signer) && 'text-red-500'}`}
                            value={signer}
                            onChange={(e) => {
                              const newSigners = [...signersAddresses];
                              newSigners[index] = e.target.value;
                              setSignerAddresses(newSigners);
                            }}
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label className="text-right">Description</Label>
                          <Input
                            className="col-span-3"
                            value={
                              parsedSignersDescriptions[index]?.isNew
                                ? parsedSignersDescriptions[index].parsed?.name || ''
                                : signersDescriptions[index]
                            }
                            onChange={(e) => {
                              if (parsedSignersDescriptions[index]?.isNew) {
                                const newParsed = [...parsedSignersDescriptions];
                                if (newParsed[index]!.parsed) {
                                  newParsed[index]!.parsed = { ...newParsed[index]!.parsed, name: e.target.value };
                                }
                                setParsedSignersDescriptions(newParsed);
                              } else {
                                const newSignersDesc = [...signersDescriptions];
                                newSignersDesc[index] = e.target.value;
                                setSignerDescriptions(newSignersDesc);
                              }
                            }}
                            placeholder="optional name or description of this signer"
                          />
                        </div>
                        {signersAddresses.filter((addr) => addr === signer).length > 1 && (
                          <p className="text-red-500">
                            This address is duplicated with another signer
                          </p>
                        )}
                        {!checkValidAddress(signer) && signer !== '' && (
                          <p className="text-red-500">
                            This address is invalid
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

                            const newSignersDesc = [...signersDescriptions];
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
                      onClick={addSigner}
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                      Add Signers
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}