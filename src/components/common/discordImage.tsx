import getDiscordAvatar from "@/lib/discord/getDiscordAvatar";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface DiscordImageProps {
  discordId: string;
}

const DiscordImage = ({ discordId }: DiscordImageProps) => {
  const [imageUrl, setImageUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchImage() {
      const url = await getDiscordAvatar(discordId);
      setImageUrl(url);
      setIsLoading(false);
    }
    fetchImage();
  }, [discordId]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          {isLoading ? (
            <></>
          ) : (
            <Image
              src={imageUrl}
              width={30}
              height={30}
              alt="Discord Connected"
              className="rounded-full"
            />
          )}
        </TooltipTrigger>
        <TooltipContent>
          <p>Discord connected</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default DiscordImage;
