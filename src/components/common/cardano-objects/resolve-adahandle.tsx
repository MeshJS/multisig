import { toast } from "@/hooks/use-toast";
import { getProvider } from "@/utils/get-provider";

export const resolveAdaHandle = async (
  setAdaHandle: (value: string) => void,
  setRecipientAddresses: (value: string[]) => void,
  recipientAddresses: string[],
  index: number,
  value: string,
) => {
  // AdaHandle lookup only supports mainnet; instantiate lazily so a missing
  // mainnet key in preprod CI environments does not crash the page on load.
  const provider = getProvider(1);
  try {
    const handleName = value.substring(1);
    if (handleName.length === 0) {
      setAdaHandle("");
      return;
    }

    const address = await provider.fetchHandleAddress(handleName);

    if (address) {
      const newAddresses = [...recipientAddresses];
      newAddresses[index] = address;
      setRecipientAddresses(newAddresses);
      setAdaHandle(value);
      toast({
        title: `ADA Handle Resolved: ${value}`,
      });
    } else {
      setAdaHandle("");
      toast({
        title: "ADA Handle Not Found",
        description: `No address found for handle: ${value}`,
        variant: "destructive",
      });
    }
  } catch (error) {
    setAdaHandle("");
    toast({
      title: "Error Resolving ADA Handle",
      description: `Failed to lookup ADA handle: ${value}`,
      variant: "destructive",
    });
  }
};
