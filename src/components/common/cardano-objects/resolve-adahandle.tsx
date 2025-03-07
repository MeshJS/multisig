import { toast } from "@/hooks/use-toast";
import { BlockfrostProvider } from "@meshsdk/core";

const provider = new BlockfrostProvider(
  process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET ?? "",
);

export const resolveAdaHandle = async (
  setAdaHandle: (value: string) => void,
  setRecipientAddresses: (value: string[]) => void,
  recipientAddresses: string[],
  index: number,
  value: string,
) => {
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
