import React, { useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, UserPlus, Loader2 } from "lucide-react";
import { Wallet } from "@/types/wallet";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";

export function ManageContacts({ appWallet }: { appWallet: Wallet }) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{
    id: string;
    name: string;
    address: string;
    description?: string | null;
  } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    description: "",
  });

  const utils = api.useUtils();
  const { data: contacts, isLoading } = api.contact.getAll.useQuery(
    { walletId: appWallet.id },
    { enabled: !!appWallet.id }
  );

  const createContact = api.contact.create.useMutation({
    onSuccess: () => {
      toast({
        title: "Contact added",
        description: "Contact has been successfully added.",
      });
      setIsAddDialogOpen(false);
      setFormData({ name: "", address: "", description: "" });
      void utils.contact.getAll.invalidate({ walletId: appWallet.id });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add contact",
        variant: "destructive",
      });
    },
  });

  const updateContact = api.contact.update.useMutation({
    onSuccess: () => {
      toast({
        title: "Contact updated",
        description: "Contact has been successfully updated.",
      });
      setIsEditDialogOpen(false);
      setSelectedContact(null);
      setFormData({ name: "", address: "", description: "" });
      void utils.contact.getAll.invalidate({ walletId: appWallet.id });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update contact",
        variant: "destructive",
      });
    },
  });

  const deleteContact = api.contact.delete.useMutation({
    onSuccess: () => {
      toast({
        title: "Contact deleted",
        description: "Contact has been successfully deleted.",
      });
      setIsDeleteDialogOpen(false);
      setSelectedContact(null);
      void utils.contact.getAll.invalidate({ walletId: appWallet.id });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete contact",
        variant: "destructive",
      });
    },
  });

  const handleAdd = () => {
    if (!formData.name.trim() || !formData.address.trim()) {
      toast({
        title: "Validation error",
        description: "Name and address are required",
        variant: "destructive",
      });
      return;
    }

    createContact.mutate({
      walletId: appWallet.id,
      name: formData.name.trim(),
      address: formData.address.trim(),
      description: formData.description.trim() || undefined,
    });
  };

  const handleEdit = () => {
    if (!selectedContact) return;
    if (!formData.name.trim() || !formData.address.trim()) {
      toast({
        title: "Validation error",
        description: "Name and address are required",
        variant: "destructive",
      });
      return;
    }

    updateContact.mutate({
      id: selectedContact.id,
      name: formData.name.trim(),
      address: formData.address.trim(),
      description: formData.description.trim() || undefined,
    });
  };

  const handleDelete = () => {
    if (!selectedContact) return;
    deleteContact.mutate({ id: selectedContact.id });
  };

  const openEditDialog = (contact: {
    id: string;
    name: string;
    address: string;
    description?: string | null;
  }) => {
    setSelectedContact(contact);
    setFormData({
      name: contact.name,
      address: contact.address,
      description: contact.description || "",
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (contact: {
    id: string;
    name: string;
    address: string;
    description?: string | null;
  }) => {
    setSelectedContact(contact);
    setIsDeleteDialogOpen(true);
  };

  return (
    <>
      <CardUI
        title="Manage Contacts"
        description="Add, edit, and manage contacts for this wallet. Contacts can be used when creating transactions."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading contacts...
                </span>
              ) : contacts && contacts.length > 0 ? (
                `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`
              ) : (
                "No contacts yet"
              )}
            </div>
            <Button
              onClick={() => {
                setFormData({ name: "", address: "", description: "" });
                setIsAddDialogOpen(true);
              }}
              size="sm"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Contact
            </Button>
          </div>

          {contacts && contacts.length > 0 && (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between p-3 border rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{contact.name}</div>
                    {contact.description && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {contact.description}
                      </div>
                    )}
                    <div className="font-mono text-xs text-muted-foreground mt-1 break-all">
                      {contact.address.slice(0, 20)}...{contact.address.slice(-20)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(contact)}
                      className="h-8 w-8 p-0"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(contact)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {contacts && contacts.length === 0 && !isLoading && (
            <div className="text-center py-8 border rounded-lg bg-muted/20">
              <UserPlus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No contacts yet. Add your first contact to get started.
              </p>
            </div>
          )}
        </div>
      </CardUI>

      {/* Add Contact Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
            <DialogDescription>
              Add a new contact to this wallet. Contacts can be used when creating transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="add-name">Name *</Label>
              <Input
                id="add-name"
                placeholder="Contact name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-address">Address *</Label>
              <Input
                id="add-address"
                placeholder="addr1..."
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-description">Description (optional)</Label>
              <Textarea
                id="add-description"
                placeholder="Additional notes about this contact"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddDialogOpen(false)}
              disabled={createContact.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createContact.isPending}
            >
              {createContact.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Add Contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Contact Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>
              Update the contact information.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                placeholder="Contact name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-address">Address *</Label>
              <Input
                id="edit-address"
                placeholder="addr1..."
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Textarea
                id="edit-description"
                placeholder="Additional notes about this contact"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setSelectedContact(null);
                setFormData({ name: "", address: "", description: "" });
              }}
              disabled={updateContact.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={updateContact.isPending}
            >
              {updateContact.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Contact Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedContact?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setSelectedContact(null);
              }}
              disabled={deleteContact.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleteContact.isPending}
              variant="destructive"
            >
              {deleteContact.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

