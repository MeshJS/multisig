import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { checkValidAddress } from "@/utils/multisigSDK";
import { getFirstAndLast } from "@/utils/strings";
import {
  Info,
  Loader2,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

export type ProxyMemberRole = "manager" | "viewer";

export interface ProxyPerson {
  address: string;
  label?: string | null;
}

interface ProxyMembersDialogProps {
  /** Proxy whose access list is being edited; null keeps the dialog closed. */
  proxyId: string | null;
  proxyName?: string | null;
  /** Signers of the controlling multisig — implicit, non-removable access. */
  signers: ProxyPerson[];
  /** Wallet contacts offered as one-click adds. */
  contacts?: ProxyPerson[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_LABEL: Record<ProxyMemberRole, string> = {
  manager: "Manager",
  viewer: "Viewer",
};

const ROLE_HINT: Record<ProxyMemberRole, string> = {
  manager: "Can view the proxy and change who has access",
  viewer: "Can view the proxy",
};

function initialsFor(label: string | null | undefined, address: string) {
  const source = label?.trim();
  if (source) {
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }
  return address.slice(5, 7).toUpperCase();
}

function PersonAvatar({
  label,
  address,
  tone = "muted",
}: {
  label?: string | null;
  address: string;
  tone?: "muted" | "primary";
}) {
  return (
    <div
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        tone === "primary"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
      }`}
      aria-hidden
    >
      {initialsFor(label, address)}
    </div>
  );
}

export default function ProxyMembersDialog({
  proxyId,
  proxyName,
  signers,
  contacts = [],
  open,
  onOpenChange,
}: ProxyMembersDialogProps) {
  const utils = api.useUtils();
  const addressInputRef = useRef<HTMLInputElement>(null);

  const [addressDraft, setAddressDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState<ProxyMemberRole>("viewer");
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([]);

  const queryInput = useMemo(
    () => ({ proxyIds: [proxyId ?? ""] }),
    [proxyId],
  );

  const { data, isLoading } = api.proxy.listProxyMembers.useQuery(queryInput, {
    enabled: open && !!proxyId,
  });

  const entry = data?.find((item) => item.proxyId === proxyId);
  const members = useMemo(() => entry?.members ?? [], [entry]);
  const canManage = entry?.canManage ?? false;

  const invalidateMembers = useCallback(async () => {
    await utils.proxy.listProxyMembers.invalidate();
  }, [utils]);

  const signerAddresses = useMemo(
    () => new Set(signers.map((signer) => signer.address)),
    [signers],
  );
  const memberAddresses = useMemo(
    () => new Set(members.map((member) => member.address)),
    [members],
  );

  const { mutateAsync: addMembers, isPending: isAdding } =
    api.proxy.addProxyMembers.useMutation({
      onSettled: invalidateMembers,
    });

  const { mutate: updateMember } = api.proxy.updateProxyMember.useMutation({
    onSettled: invalidateMembers,
    onError: (error) => {
      toast({
        title: "Could not update access",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { mutateAsync: removeMember } = api.proxy.removeProxyMember.useMutation({
    onSettled: invalidateMembers,
  });

  const addressError = useMemo(() => {
    const value = addressDraft.trim();
    if (value.length === 0) return null;
    if (!checkValidAddress(value)) return "That doesn't look like a Cardano address.";
    if (signerAddresses.has(value)) return "This signer already has access.";
    if (memberAddresses.has(value)) return "This person already has access.";
    return null;
  }, [addressDraft, signerAddresses, memberAddresses]);

  const canSubmitDraft =
    addressDraft.trim().length > 0 && addressError === null && !isAdding;

  const grant = useCallback(
    async (
      people: Array<{ address: string; label?: string | null; role: ProxyMemberRole }>,
    ) => {
      if (!proxyId || people.length === 0) return;
      setPendingAddresses((prev) => [...prev, ...people.map((p) => p.address)]);
      try {
        await addMembers({
          proxyId,
          members: people.map((person) => ({
            address: person.address,
            role: person.role,
            label: person.label?.trim() ? person.label.trim() : undefined,
          })),
        });
        toast({
          title: people.length === 1 ? "Access granted" : "Access granted",
          description:
            people.length === 1
              ? `${people[0]!.label?.trim() || getFirstAndLast(people[0]!.address, 10, 6)} can now see this proxy.`
              : `${people.length} people can now see this proxy.`,
        });
      } catch (error) {
        toast({
          title: "Could not grant access",
          description:
            error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setPendingAddresses((prev) =>
          prev.filter((address) => !people.some((p) => p.address === address)),
        );
      }
    },
    [proxyId, addMembers],
  );

  const handleAddDraft = useCallback(async () => {
    if (!canSubmitDraft) return;
    const address = addressDraft.trim();
    const label = labelDraft;
    const role = roleDraft;
    setAddressDraft("");
    setLabelDraft("");
    addressInputRef.current?.focus();
    await grant([{ address, label, role }]);
  }, [canSubmitDraft, addressDraft, labelDraft, roleDraft, grant]);

  const handleRemove = useCallback(
    async (member: { address: string; label: string | null; role: string }) => {
      if (!proxyId) return;
      setPendingAddresses((prev) => [...prev, member.address]);
      try {
        await removeMember({ proxyId, address: member.address });
        toast({
          title: "Access removed",
          description: `${member.label?.trim() || getFirstAndLast(member.address, 10, 6)} can no longer see this proxy.`,
          action: (
            <ToastAction
              altText="Undo removing access"
              onClick={() => {
                void grant([
                  {
                    address: member.address,
                    label: member.label,
                    role: (member.role === "manager" ? "manager" : "viewer"),
                  },
                ]);
              }}
            >
              Undo
            </ToastAction>
          ),
        });
      } catch (error) {
        toast({
          title: "Could not remove access",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setPendingAddresses((prev) =>
          prev.filter((address) => address !== member.address),
        );
      }
    },
    [proxyId, removeMember, grant],
  );

  // People worth one-click adding: wallet contacts who aren't already covered.
  const suggestions = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          checkValidAddress(contact.address) &&
          !signerAddresses.has(contact.address) &&
          !memberAddresses.has(contact.address),
      ),
    [contacts, signerAddresses, memberAddresses],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            People with access
          </DialogTitle>
          <DialogDescription>
            {proxyName
              ? `Who can see and manage “${proxyName}” in this app.`
              : "Who can see and manage this proxy in this app."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Access here is in-app only. Spending from the proxy and signing on
            its behalf still requires the multisig signers who hold the auth
            token — adding someone here never gives them on-chain authority.
          </p>
        </div>

        {/* Add form */}
        {canManage && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Input
                  ref={addressInputRef}
                  value={addressDraft}
                  onChange={(event) => setAddressDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddDraft();
                    }
                  }}
                  placeholder="Paste a wallet address (addr1…)"
                  aria-label="Address to grant access to"
                  aria-invalid={addressError !== null}
                  className={addressError ? "border-destructive" : undefined}
                />
              </div>
              <Input
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAddDraft();
                  }
                }}
                placeholder="Name (optional)"
                aria-label="Name for this person"
                className="sm:w-40"
              />
              <Select
                value={roleDraft}
                onValueChange={(value) => setRoleDraft(value as ProxyMemberRole)}
              >
                <SelectTrigger className="sm:w-32" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => void handleAddDraft()}
                disabled={!canSubmitDraft}
                className="sm:w-auto"
              >
                {isAdding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            {addressError && (
              <p className="text-xs text-destructive">{addressError}</p>
            )}
            {!addressError && (
              <p className="text-xs text-muted-foreground">
                {ROLE_HINT[roleDraft]}. Press Enter to add.
              </p>
            )}

            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">
                  From contacts:
                </span>
                {suggestions.slice(0, 6).map((contact) => (
                  <Button
                    key={contact.address}
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-full px-3 text-xs"
                    disabled={pendingAddresses.includes(contact.address)}
                    onClick={() =>
                      void grant([
                        {
                          address: contact.address,
                          label: contact.label,
                          role: "viewer",
                        },
                      ])
                    }
                  >
                    {pendingAddresses.includes(contact.address) ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="mr-1 h-3 w-3" />
                    )}
                    {contact.label?.trim() ||
                      getFirstAndLast(contact.address, 8, 4)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Signers — implicit access */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Multisig signers
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {signers.length}
            </Badge>
          </div>
          <div className="space-y-1">
            {signers.map((signer) => (
              <div
                key={signer.address}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
              >
                <PersonAvatar
                  label={signer.label}
                  address={signer.address}
                  tone="primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {signer.label?.trim() || "Signer"}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {getFirstAndLast(signer.address, 12, 8)}
                  </div>
                </div>
                <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                  Always has access
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Shared with */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Shared with
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {members.length}
            </Badge>
          </div>

          {isLoading ? (
            <div className="space-y-1">
              <div className="h-12 animate-pulse rounded-lg bg-muted" />
              <div className="h-12 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Only the multisig signers can see this proxy.
              </p>
              {canManage && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Paste an address above to share it with someone else.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((member) => {
                const busy = pendingAddresses.includes(member.address);
                return (
                  <div
                    key={member.id}
                    className={`flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2 transition-opacity ${
                      busy ? "opacity-50" : ""
                    }`}
                  >
                    <PersonAvatar label={member.label} address={member.address} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {member.label?.trim() || "Invited person"}
                        </span>
                        {member.isSelf && (
                          <Badge variant="outline" className="text-[10px]">
                            You
                          </Badge>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {getFirstAndLast(member.address, 12, 8)}
                      </div>
                    </div>

                    {canManage ? (
                      <Select
                        value={member.role === "manager" ? "manager" : "viewer"}
                        onValueChange={(value) => {
                          if (!proxyId) return;
                          updateMember({
                            proxyId,
                            address: member.address,
                            role: value as ProxyMemberRole,
                          });
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-[110px] flex-shrink-0 text-xs"
                          aria-label={`Role for ${member.label ?? member.address}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="flex-shrink-0 text-[10px]">
                        {ROLE_LABEL[member.role === "manager" ? "manager" : "viewer"]}
                      </Badge>
                    )}

                    {(canManage || member.isSelf) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        aria-label={
                          member.isSelf && !canManage
                            ? "Leave this proxy"
                            : `Remove access for ${member.label ?? member.address}`
                        }
                        onClick={() =>
                          void handleRemove({
                            address: member.address,
                            label: member.label,
                            role: member.role,
                          })
                        }
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
