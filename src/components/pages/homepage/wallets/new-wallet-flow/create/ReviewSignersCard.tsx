import React from "react";
import { getFirstAndLast } from "@/utils/strings";
import { checkValidAddress, checkValidStakeKey } from "@/utils/multisigSDK";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  PlusCircle,
  ChevronLeft,
  Trash2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deserializeAddress, serializeRewardAddress } from "@meshsdk/core";

const MAX_SIGNER_NAME_LENGTH = 32;

// Same SignerConfig interface as original
interface SignerConfig {
  signersAddresses: string[];
  setSignerAddresses: React.Dispatch<React.SetStateAction<string[]>>;
  signersDescriptions: string[];
  setSignerDescriptions: React.Dispatch<React.SetStateAction<string[]>>;
  signersStakeKeys: string[];
  setSignerStakeKeys: React.Dispatch<React.SetStateAction<string[]>>;
  addSigner: () => void;
  removeSigner?: (index: number) => void;
}

interface ReviewSignersCardProps {
  signerConfig: SignerConfig;
  currentUserAddress?: string;
  walletId?: string;
  hasExternalStakeCredential?: boolean;
  onSave?: (
    signersAddresses: string[],
    signersDescriptions: string[],
    signersStakeKeys: string[],
  ) => void;
}

const ReviewSignersCard: React.FC<ReviewSignersCardProps> = ({
  signerConfig,
  currentUserAddress,
  walletId,
  hasExternalStakeCredential = false,
  onSave,
}) => {
  const {
    signersAddresses,
    setSignerAddresses,
    signersDescriptions,
    setSignerDescriptions,
    signersStakeKeys = [],
    setSignerStakeKeys,
    addSigner,
    removeSigner,
  } = signerConfig;

  const { toast } = useToast();

  // State for edit mode
  const [editMode, setEditMode] = React.useState<"list" | "edit" | "add">(
    "list",
  );
  const [editIndex, setEditIndex] = React.useState<number>(-1);

  // Temporary form state
  const [tempAddress, setTempAddress] = React.useState("");
  const [tempStakeKey, setTempStakeKey] = React.useState("");
  const [tempDescription, setTempDescription] = React.useState("");

  // Start editing a signer
  const startEdit = (index: number) => {
    setEditIndex(index);
    setTempAddress(signersAddresses[index] || "");
    setTempStakeKey(signersStakeKeys[index] || "");
    setTempDescription(signersDescriptions[index] || "");
    setEditMode("edit");
  };

  // Start adding a new signer
  const startAdd = () => {
    setTempAddress("");
    setTempStakeKey("");
    setTempDescription("");
    setEditMode("add");
  };

  // Save changes
  const saveChanges = () => {
    let newAddresses = signersAddresses;
    let newDescriptions = signersDescriptions;
    let newStakeKeys = signersStakeKeys;

    if (editMode === "edit" && editIndex >= 0) {
      const updatedAddresses = [...signersAddresses];
      const updatedStakeKeys = [...signersStakeKeys];
      const updatedDescriptions = [...signersDescriptions];

      updatedAddresses[editIndex] = tempAddress;
      updatedStakeKeys[editIndex] = tempStakeKey;
      updatedDescriptions[editIndex] = tempDescription;

      newAddresses = updatedAddresses;
      newDescriptions = updatedDescriptions;
      newStakeKeys = updatedStakeKeys;

      setSignerAddresses(updatedAddresses);
      setSignerStakeKeys(updatedStakeKeys);
      setSignerDescriptions(updatedDescriptions);
    } else if (editMode === "add") {
      newAddresses = [...signersAddresses, tempAddress];
      // Don't add stake key if external stake credential is set
      newStakeKeys = [...signersStakeKeys, hasExternalStakeCredential ? "" : tempStakeKey];
      newDescriptions = [...signersDescriptions, tempDescription];

      setSignerAddresses(newAddresses);
      setSignerStakeKeys(newStakeKeys);
      setSignerDescriptions(newDescriptions);
    }

    setEditMode("list");

    if (onSave) {
      onSave(newAddresses, newDescriptions, newStakeKeys);
    }
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditMode("list");
    setEditIndex(-1);
  };

  // State for delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [signerToDelete, setSignerToDelete] = React.useState<number | null>(
    null,
  );

  // Handle delete button click
  const handleDeleteClick = (index: number) => {
    setSignerToDelete(index);
    setDeleteDialogOpen(true);
  };

  // Confirm deletion
  const confirmDelete = () => {
    if (signerToDelete !== null && removeSigner) {
      removeSigner(signerToDelete);
      toast({
        title: "Signer removed",
        description: "The signer has been removed from the wallet.",
        duration: 2000,
      });

      // Create new arrays with the removed signer
      const newAddresses = [...signersAddresses];
      const newDescriptions = [...signersDescriptions];
      const newStakeKeys = [...signersStakeKeys];

      newAddresses.splice(signerToDelete, 1);
      newDescriptions.splice(signerToDelete, 1);
      newStakeKeys.splice(signerToDelete, 1);

      if (onSave) {
        onSave(newAddresses, newDescriptions, newStakeKeys);
      }
    }
    setDeleteDialogOpen(false);
    setSignerToDelete(null);
  };

  return (
    <Card className="overflow-visible">
      {editMode !== "list" && (
        <>
          {/* Back button at the very top of the card */}
          <div className="px-6 py-3">
            <button
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to all signers
            </button>
          </div>
          {/* Divider */}
          <div className="px-6">
            <div className="border-b" />
          </div>
        </>
      )}
      <CardHeader>
        <CardTitle>
          {editMode === "list"
            ? "Signers"
            : editMode === "edit"
              ? `Edit ${editIndex === 0 ? "Creator" : `Signer ${editIndex + 1}`}`
              : "Add Signer"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6">
        {editMode === "list" ? (
          <div className="space-y-4">
            {/* Desktop: Table View */}
            <div className="hidden sm:block">
              <Table className="overflow-hidden rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[25%]">Signer name</TableHead>
                    <TableHead className="w-[40%]">Address</TableHead>
                    <TableHead className="w-[13%]">Stake Key</TableHead>
                    <TableHead className="w-[12%]">Edit</TableHead>
                    <TableHead className="w-[10%]">Delete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signersAddresses.map((signer, index) => (
                    <TableRow key={index}>
                      {/* Signer name */}
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {signersDescriptions[index] ? (
                            <span className="font-medium">
                              {signersDescriptions[index]}
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground">
                              Signer {index + 1}
                            </span>
                          )}
                          {currentUserAddress &&
                            signer === currentUserAddress && (
                              <span className="text-sm text-muted-foreground">
                                (self)
                              </span>
                            )}
                        </span>
                      </TableCell>

                      {/* Address */}
                      <TableCell className="font-mono text-xs">
                        {signer ? getFirstAndLast(signer, 20, 15) : "-"}
                      </TableCell>

                      {/* Stake Key */}
                      <TableCell>
                        {signersStakeKeys[index] ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-sm underline decoration-dotted">
                                  Yes
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="break-all font-mono text-xs">
                                  {signersStakeKeys[index]}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Edit */}
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(index)}
                        >
                          Edit
                        </Button>
                      </TableCell>

                      {/* Delete */}
                      <TableCell>
                        {index > 0 && removeSigner ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteClick(index)}
                            className="p-2 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: Card View */}
            <div className="space-y-3 sm:hidden">
              {signersAddresses.map((signer, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border border-black/10 p-4 dark:border-white/5"
                >
                  {/* Top row: Name and Actions */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {signersDescriptions[index] ? (
                        <p className="font-medium">
                          {signersDescriptions[index]}
                        </p>
                      ) : (
                        <p className="italic text-muted-foreground">
                          Signer {index + 1}
                        </p>
                      )}
                      {currentUserAddress && signer === currentUserAddress && (
                        <span className="text-sm text-muted-foreground">
                          (self)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(index)}
                        className="h-8 px-2"
                      >
                        Edit
                      </Button>
                      {index > 0 && removeSigner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteClick(index)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="break-all font-mono text-xs">
                      {signer ? getFirstAndLast(signer, 20, 15) : "-"}
                    </p>
                  </div>

                  {/* Stake Key */}
                  <div>
                    <p className="text-xs text-muted-foreground">Stake Key</p>
                    {signersStakeKeys[index] ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-sm underline decoration-dotted">
                              Yes
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="break-all font-mono text-xs">
                              {signersStakeKeys[index]}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Signer Button */}
            <Button
              onClick={startAdd}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Add signer
            </Button>

            {/* Divider before optional section */}
            {walletId && <div className="my-4 border-t" />}

            {/* Invite Link Section */}
            {walletId && (
              <div className="space-y-2">
                <Label className="text-sm">Add signers by invitation</Label>
                <p className="text-xs text-muted-foreground">
                  Optional: Share the link below and let signers add themselves
                  to the wallet
                </p>
                <div className="flex items-center gap-2 rounded-md bg-muted p-2.5">
                  <span className="flex-1 break-all font-mono text-xs">
                    {`https://multisig.meshjs.dev/wallets/invite/${walletId}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `https://multisig.meshjs.dev/wallets/invite/${walletId}`,
                      );
                      toast({
                        title: "Copied!",
                        description: "Invite link copied to clipboard",
                        duration: 3000,
                      });
                    }}
                    className="h-auto flex-shrink-0 p-1"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Edit/Add Form with background */}
            <div className="space-y-4 rounded-lg bg-muted/50 p-4">
              {/* Address field - stacked on mobile */}
              <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-4">
                <Label htmlFor="address" className="text-sm">
                  Address
                </Label>
                <div>
                  <Input
                    id="address"
                    className={`break-all font-mono text-xs sm:text-sm ${
                      tempAddress
                        ? checkValidAddress(tempAddress)
                          ? signersAddresses.filter(
                              (addr, idx) =>
                                addr === tempAddress &&
                                (editMode === "add" || idx !== editIndex),
                            ).length > 0
                            ? "!border-red-500 focus:!border-red-500"
                            : "!border-green-500 focus:!border-green-500"
                          : "!border-red-500 focus:!border-red-500"
                        : ""
                    }`}
                    placeholder="Cardano wallet address"
                    value={tempAddress}
                    onChange={(e) => {
                      setTempAddress(e.target.value);
                      try {
                        // Deserialize the address to get the stake credential hash
                        const stakeHash = deserializeAddress(
                          e.target.value,
                        ).stakeCredentialHash;
                        // Determine network based on address type
                        const network = e.target.value.includes("test") ? 0:1;
                        // Serialize the stake address
                        const stakeAddress = serializeRewardAddress(stakeHash,false,network);
                        setTempStakeKey(stakeAddress || "");
                      } catch (e) {}
                    }}
                    disabled={editMode === "edit" && editIndex === 0}
                  />
                  {tempAddress &&
                    checkValidAddress(tempAddress) &&
                    signersAddresses.filter(
                      (addr, idx) =>
                        addr === tempAddress &&
                        (editMode === "add" || idx !== editIndex),
                    ).length === 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        <p className="text-xs text-green-500">
                          Valid address format
                        </p>
                      </div>
                    )}
                  {tempAddress && !checkValidAddress(tempAddress) && (
                    <div className="mt-1 flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" />
                      <p className="text-xs text-red-500">
                        Invalid address format
                      </p>
                    </div>
                  )}
                  {tempAddress &&
                    checkValidAddress(tempAddress) &&
                    signersAddresses.filter(
                      (addr, idx) =>
                        addr === tempAddress &&
                        (editMode === "add" || idx !== editIndex),
                    ).length > 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        <p className="text-xs text-red-500">
                          This address is duplicated.
                        </p>
                      </div>
                    )}
                </div>
              </div>

              {/* Stake Key field - stacked on mobile */}
              <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-4">
                <Label htmlFor="stakeKey" className="text-sm">
                  Stake Key{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <div>
                  <Input
                    id="stakeKey"
                    className={`break-all font-mono text-xs sm:text-sm ${
                      tempStakeKey
                        ? checkValidStakeKey(tempStakeKey)
                          ? "!border-green-500 focus:!border-green-500"
                          : "!border-red-500 focus:!border-red-500"
                        : ""
                    }`}
                    placeholder={hasExternalStakeCredential ? "External stake credential configured" : "Staking address"}
                    value={tempStakeKey}
                    onChange={(e) => setTempStakeKey(e.target.value)}
                    disabled={editMode === "edit" && editIndex === 0 || hasExternalStakeCredential}
                  />
                  {tempStakeKey && checkValidStakeKey(tempStakeKey) && (
                    <div className="mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <p className="text-xs text-green-500">
                        Valid stake key format
                      </p>
                    </div>
                  )}
                  {tempStakeKey && !checkValidStakeKey(tempStakeKey) && (
                    <div className="mt-1 flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-red-500" />
                      <p className="text-xs text-red-500">
                        Invalid stake key format
                      </p>
                    </div>
                  )}
                  {hasExternalStakeCredential && (
                    <div className="mt-1 flex items-center gap-1">
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        ℹ️ This wallet uses an external stake credential. Stake keys will not be imported.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Name field - stacked on mobile */}
              <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-4">
                <Label htmlFor="signerName" className="text-sm">
                  Signer name{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <div className="space-y-2">
                  <Input
                    id="signerName"
                    placeholder="Jane"
                    value={tempDescription}
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_SIGNER_NAME_LENGTH) {
                        setTempDescription(e.target.value);
                      }
                    }}
                  />
                  <div className="space-y-1">
                    <div
                      className={`text-xs ${tempDescription.length >= MAX_SIGNER_NAME_LENGTH ? "text-amber-600" : "text-gray-500"}`}
                    >
                      <span>
                        {tempDescription.length}/{MAX_SIGNER_NAME_LENGTH}{" "}
                        characters
                        {tempDescription.length >= MAX_SIGNER_NAME_LENGTH &&
                          ", maximum reached"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The name helps other signers identify this signer
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
              {editMode === "add" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    saveChanges();
                    // Reset form for next signer
                    setTimeout(() => {
                      startAdd();
                    }, 100);
                  }}
                  disabled={Boolean(
                    !tempAddress.trim() ||
                      !checkValidAddress(tempAddress) ||
                      signersAddresses.filter(
                        (addr, idx) =>
                          addr === tempAddress &&
                          (editMode === "add" || idx !== editIndex),
                      ).length > 0 ||
                      (tempStakeKey && !checkValidStakeKey(tempStakeKey)),
                  )}
                >
                  Save & Add Another
                </Button>
              )}
              <Button
                size="sm"
                onClick={saveChanges}
                disabled={Boolean(
                  !tempAddress ||
                    !checkValidAddress(tempAddress) ||
                    signersAddresses.filter(
                      (addr, idx) =>
                        addr === tempAddress &&
                        (editMode === "add" || idx !== editIndex),
                    ).length > 0 ||
                    (tempStakeKey && !checkValidStakeKey(tempStakeKey)),
                )}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-gray-200 bg-gray-50 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Signer</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this signer?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ReviewSignersCard;
