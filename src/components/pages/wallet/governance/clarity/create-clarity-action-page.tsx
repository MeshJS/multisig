import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import useAppWallet from "@/hooks/useAppWallet";
import { api } from "@/utils/api";

export default function CreateClarityActionPage() {
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use the API hook outside of useEffect
  const { data: walletData, isLoading } = api.wallet.getWallet.useQuery(
    {
      walletId: appWallet?.id ?? "",
      address: appWallet?.signersAddresses[0] ?? "",
    },
    {
      enabled: !!appWallet?.id && !!appWallet?.signersAddresses[0],
    },
  );

  const clarityOrgId = walletData?.clarityOrgId ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !clarityOrgId) return;

    setLoading(true);
    try {
      // Here you would implement the actual submission logic
      // This could involve calling an API endpoint to create a new governance action
      console.log("Creating new governance action:", {
        title,
        description,
        clarityOrgId,
        walletId: appWallet?.id,
      });

      // After successful submission, redirect back to the governance page
      router.push(`/wallets/${appWallet?.id}/governance`);
    } catch (error) {
      console.error("Error creating governance action:", error);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (error || !clarityOrgId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>
              {error || "No Clarity Organization ID found for this wallet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/wallets/${appWallet?.id}/governance`}>
              <Button>
                <ArrowLeftIcon className="mr-2 h-4 w-4" /> Back to Governance
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <Link href={`/wallets/${appWallet?.id}/governance`}>
          <Button variant="outline" size="sm">
            <ArrowLeftIcon className="mr-2 h-4 w-4" /> Back to Governance
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create New Governance Action on Clarity</CardTitle>
          <CardDescription>
            Create a new governance action for your Clarity Organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter action title"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter action description"
                rows={5}
                required
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create Governance Action"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
