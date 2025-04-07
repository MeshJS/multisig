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
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import useAppWallet from "@/hooks/useAppWallet";
import { api } from "@/utils/api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { v4 as uuidv4 } from "uuid";
import { toast } from "@/hooks/use-toast";
import { useSiteStore } from "@/lib/zustand/site";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  name: string;
  description: string;
  id: string;
}

interface VotingPowerCalculation {
  id: string;
  name: string;
  description: string;
  type: string;
  assets?: Array<{
    id: string;
    scale: string;
    type: string;
    weight: number;
  }>;
}

function formatDateForLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  // Format to YYYY-MM-DDThh:mm format in local time
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseLocalDateToUTC(dateString: string): number {
  // Parse the local datetime string and convert to UTC timestamp
  const [datePart, timePart] = dateString.split("T");
  const [year, month, day] = datePart?.split("-").map(Number) ?? [];
  const [hours, minutes] = timePart?.split(":").map(Number) ?? [];

  // Create date in local time zone
  const localDate = new Date(
    year ?? 0,
    (month ?? 0) - 1,
    day ?? 0,
    hours ?? 0,
    minutes ?? 0,
  );

  // Return the UTC timestamp
  return localDate.getTime();
}

export default function CreateClarityActionPage() {
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<Option[]>([
    { name: "Yes", description: "", id: uuidv4() },
    { name: "No", description: "", id: uuidv4() },
  ]);
  const [numWinners, setNumWinners] = useState(1);
  const [votingOpensDate, setVotingOpensDate] = useState<number>(Date.now());
  const [votingDeadline, setVotingDeadline] = useState<number>(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ); // Default: 1 week from now

  // Advanced settings
  const [minWinningVotingPower, setMinWinningVotingPower] = useState(0);
  const [winningPercentageThreshold, setWinningPercentageThreshold] =
    useState(0);
  const [allowMultipleVotes, setAllowMultipleVotes] = useState(false);
  const [showVoteCount, setShowVoteCount] = useState(false);
  const [votingPowerCalculations, setVotingPowerCalculations] = useState<
    Record<string, VotingPowerCalculation>
  >({});
  const [selectedVotingPowerCalculation, setSelectedVotingPowerCalculation] =
    useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const network = useSiteStore((state) => state.network);

  const { data: walletData, isLoading } = api.wallet.getWallet.useQuery(
    {
      walletId: appWallet?.id ?? "",
      address: appWallet?.signersAddresses[0] ?? "",
    },
    {
      enabled: !!appWallet?.id && !!appWallet?.signersAddresses[0],
    },
  );

  // Fetch voting power calculations
  useEffect(() => {
    const fetchVotingPowerCalculations = async () => {
      if (!appWallet?.clarityApiKey) return;

      try {
        const response = await fetch(
          `${network === 1 ? "https://api.clarity.vote" : "https://preview.api.clarity.vote"}/dao/votingPowerCalculations`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${appWallet.clarityApiKey}`,
            },
          },
        );

        if (!response.ok) {
          console.error(
            "Failed to fetch voting power calculations:",
            response.status,
          );
          return;
        }

        const data = await response.json();
        setVotingPowerCalculations(data);
      } catch (error) {
        console.error("Error fetching voting power calculations:", error);
      }
    };

    fetchVotingPowerCalculations();
  }, [appWallet?.clarityApiKey, network]);

  const handleAddOption = () => {
    const id = uuidv4();
    setOptions([...options, { name: "", description: "", id: id }]);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length > 1) {
      const newOptions = [...options];
      newOptions.splice(index, 1);
      setOptions(newOptions);
    }
  };

  const handleOptionChange = (
    index: number,
    field: keyof Option,
    value: string,
  ) => {
    const newOptions = [...options];
    if (!newOptions[index]) return;
    newOptions[index][field] = value;
    setOptions(newOptions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) {
      toast({
        title: "Title is required",
        description: "Please enter a title.",
        variant: "destructive",
      });
      return;
    }
    if (!description) {
      toast({
        title: "Description is required",
        description: "Please enter a description.",
        variant: "destructive",
      });
      return;
    }
    if (!appWallet?.clarityApiKey) {
      toast({
        title: "Clarity API key is required",
        description:
          "Make sure your Clarity API Key is linked from your Governance Page of the Mesh Multisig App.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedVotingPowerCalculation) {
      toast({
        title: "Voting power calculation is required",
        description: "Please select a voting power calculation.",
        variant: "destructive",
      });
      return;
    }

    // Validate options
    if (options.some((option) => !option.name.trim())) {
      setError("All options must have a name");
      return;
    }

    setLoading(true);
    try {
      const optionsObject: {
        [id: string]: Option;
      } = {};
      options.map((option) => {
        optionsObject[option.id] = {
          name: option.name,
          description: option.description,
          id: option.id,
        };
      });

      console.log(
        "making request to",
        `${network === 1 ? "https://api.clarity.vote" : "https://preview.api.clarity.vote"}/govActions/snapshots/createSnapshotProposal`,
        "api key",
        appWallet?.clarityApiKey,
      );
      // Make API call to Clarity
      const response = await fetch(
        `${network === 1 ? "https://api.clarity.vote" : "https://preview.api.clarity.vote"}/govActions/snapshots/createSnapshotProposal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${appWallet?.clarityApiKey ?? ""}`, // Replace with actual token
          },
          body: JSON.stringify({
            snapshotProposalMetadata: {
              creator: appWallet?.address,
              name: title,
              description,
              options: optionsObject,
              votingOpensDate,
              votingDeadline,
              limitVoteOneSubmission: !allowMultipleVotes,
              showVoteCount,
              daoId: "Clarity",
              shuffleSubmissions: false,
              votingPowerCalculation: selectedVotingPowerCalculation,
              quorum: {
                numberOfWinners: numWinners,
                winningPercentageThreshold,
                winningVoteThreshold: minWinningVotingPower,
              },
            },
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        toast({
          title: "Error",
          description: errorData?.message || `API error: ${response.status}`,
          duration: 5000,
        });
        return;
      }

      toast({
        title: "Governance action created",
        description:
          "Your governance action has been created on the Clarity Platform.",
        duration: 5000,
      });

      setTitle("");
      setDescription("");
      setOptions([
        { name: "Yes", description: "", id: uuidv4() },
        { name: "No", description: "", id: uuidv4() },
      ]);
      setNumWinners(1);
      setVotingOpensDate(Date.now());
      setVotingDeadline(Date.now() + 7 * 24 * 60 * 60 * 1000);
      setMinWinningVotingPower(0);
      setWinningPercentageThreshold(50);
      setAllowMultipleVotes(false);
      setShowVoteCount(false);

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

  if (error || !appWallet?.clarityApiKey) {
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
            {/* Basic Information */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter action name"
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
            </div>

            {/* Options */}
            <div className="space-y-4">
              <h3 className="text-md font-medium">Options</h3>
              {options.map((option, index) => (
                <div key={index} className="space-y-3 rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Option {index + 1}</h4>
                    {options.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveOption(index)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={`option-name-${index}`}
                      className="text-sm font-medium"
                    >
                      Name
                    </label>
                    <Input
                      id={`option-name-${index}`}
                      value={option.name}
                      onChange={(e) =>
                        handleOptionChange(index, "name", e.target.value)
                      }
                      placeholder="Option name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={`option-description-${index}`}
                      className="text-sm font-medium"
                    >
                      Description
                    </label>
                    <Textarea
                      id={`option-description-${index}`}
                      value={option.description}
                      onChange={(e) =>
                        handleOptionChange(index, "description", e.target.value)
                      }
                      placeholder="Option description"
                      rows={2}
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={handleAddOption}
                className="w-full"
              >
                <PlusIcon className="mr-2 h-4 w-4" /> Add Option
              </Button>
            </div>

            {/* Voting Configuration */}
            <div className="space-y-4">
              <h3 className="text-md font-medium">Voting Configuration</h3>

              {/* Voting Power Calculation Dropdown */}
              <div className="space-y-2">
                <label
                  htmlFor="votingPowerCalculation"
                  className="text-sm font-medium"
                >
                  Voting Power Calculation
                </label>
                <Select
                  value={selectedVotingPowerCalculation}
                  onValueChange={setSelectedVotingPowerCalculation}
                >
                  <SelectTrigger id="votingPowerCalculation" className="w-full">
                    <SelectValue placeholder="Select voting power calculation" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(votingPowerCalculations).map(
                      ([id, calc]) => (
                        <SelectItem key={id} value={id}>
                          {calc.name}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                {selectedVotingPowerCalculation &&
                  votingPowerCalculations[selectedVotingPowerCalculation] && (
                    <p className="text-xs text-muted-foreground">
                      {
                        votingPowerCalculations[selectedVotingPowerCalculation]
                          .description
                      }
                    </p>
                  )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor="votingOpensDate"
                    className="text-sm font-medium"
                  >
                    Voting Opens Date
                  </label>
                  <Input
                    id="votingOpensDate"
                    type="datetime-local"
                    value={formatDateForLocalInput(votingOpensDate)}
                    onChange={(e) =>
                      setVotingOpensDate(parseLocalDateToUTC(e.target.value))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="votingDeadline"
                    className="text-sm font-medium"
                  >
                    Voting Deadline
                  </label>
                  <Input
                    id="votingDeadline"
                    type="datetime-local"
                    value={formatDateForLocalInput(votingDeadline)}
                    onChange={(e) =>
                      setVotingDeadline(parseLocalDateToUTC(e.target.value))
                    }
                    required
                  />
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="advanced-settings">
                <AccordionTrigger>Advanced Settings</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <label
                        htmlFor="numWinners"
                        className="text-sm font-medium"
                      >
                        Number of Winners
                      </label>
                      <Input
                        id="numWinners"
                        type="number"
                        min={1}
                        max={options.length}
                        value={numWinners}
                        onChange={(e) =>
                          setNumWinners(parseInt(e.target.value))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="minWinningVotingPower"
                        className="text-sm font-medium"
                      >
                        Minimum Winning Voting Power
                      </label>
                      <Input
                        id="minWinningVotingPower"
                        type="number"
                        min={0}
                        value={minWinningVotingPower}
                        onChange={(e) =>
                          setMinWinningVotingPower(parseInt(e.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="winningPercentageThreshold"
                        className="text-sm font-medium"
                      >
                        Winning Percentage Threshold
                      </label>
                      <Input
                        id="winningPercentageThreshold"
                        type="number"
                        min={1}
                        max={100}
                        value={winningPercentageThreshold}
                        onChange={(e) =>
                          setWinningPercentageThreshold(
                            parseInt(e.target.value),
                          )
                        }
                      />
                    </div>
                    <Separator className="my-2" />
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="allowMultipleVotes"
                          checked={allowMultipleVotes}
                          onCheckedChange={(checked) =>
                            setAllowMultipleVotes(!!checked)
                          }
                        />
                        <Label htmlFor="allowMultipleVotes">
                          Allow voting on multiple submissions
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="showVoteCount"
                          checked={showVoteCount}
                          onCheckedChange={(checked) =>
                            setShowVoteCount(!!checked)
                          }
                        />
                        <Label htmlFor="showVoteCount">
                          Show vote count during voting
                        </Label>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating..." : "Create Governance Action"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
