import Image, { ImageProps } from "next/image";
import { useMemo } from "react";

// List of IPFS gateways to try
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

// Default gateway to use
const DEFAULT_GATEWAY = IPFS_GATEWAYS[0];

interface IPFSImageProps extends Omit<ImageProps, "src"> {
  src: string;
  gatewayIndex?: number;
}

export const IPFSImage = ({
  src,
  gatewayIndex = 0,
  alt = "",
  ...props
}: IPFSImageProps) => {
  const ipfsUrl = useMemo(() => {
    if (!src) return "";

    // Check if the source is an IPFS URL
    if (src.startsWith("ipfs://")) {
      const cid = src.replace("ipfs://", "");
      const gateway = IPFS_GATEWAYS[gatewayIndex] || DEFAULT_GATEWAY;
      return `${gateway}${cid}`;
    }

    // Return the original source if it's not an IPFS URL
    return src;
  }, [src, gatewayIndex]);

  // If there's no source, return null
  if (!ipfsUrl) return null;

  return <Image src={ipfsUrl} alt={alt} {...props} />;
};

export default IPFSImage;
