import { useState, useEffect } from "react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import { deserializeAddress } from "@meshsdk/core";

export function LaunchCrowdfund() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [deadline, setDeadline] = useState("");
  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");
  const [created, setCreated] = useState("");

  const { toast } = useToast();
  const { user } = useUser();

  useEffect(() => {
    if (user?.address) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) setProposerKeyHashR0(pubKeyHash);
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address]);

  const createCrowdfund = api.crowdfund.createCrowdfund.useMutation({
    onSuccess: () => {
      toast({ title: "Crowdfund created successfully" });
      setName("");
      setProposerKeyHashR0("");
    },
    onError: (err) => {
      toast({ title: "Error setting up crowdfund", description: err.message });
    },
  });

  const handleCreate = () => {
    if (!name || !proposerKeyHashR0) {
      toast({
        title: "Missing fields",
        description: "Please provide both name and proposer key hash.",
      });
      return;
    }
    createCrowdfund.mutate(
      {
        name,
        proposerKeyHashR0,
      },
      {
        onSuccess: (data) => {
          if (data?.id) {
            setCreated(data.id);
          }
        },
      },
    );
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">{`Create new Crowdfund ${created ? name : "hi"}`}</h2>
      {!created && (
        <div className="flex flex-col gap-4">
          <Input
            placeholder="Crowdfund Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          
          <Button onClick={handleCreate} disabled={createCrowdfund.isPending || !name || !proposerKeyHashR0}>
            {createCrowdfund.isPending ? "Creating..." : "Next"}
          </Button>
        </div>
      )}
      {created && (
        <div className="mt-4">
          <Input
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            placeholder="Funding Goal (in ADA)"
            type="number"
            value={fundingGoal}
            onChange={(e) => setFundingGoal(e.target.value)}
          />
          <Input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
