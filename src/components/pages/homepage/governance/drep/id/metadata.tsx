import React from "react";
import CardUI from "@/components/ui/card-content";
import { BlockfrostDrepMetadata } from "@/types/governance";
import { extractJsonLdValue } from "@/utils/jsonLdParser";
import {
  Twitter,
  Instagram,
  MessageCircle,
  Link as LinkIcon,
} from "lucide-react";
import Code from "@/components/ui/code";

export default function Metadata({
  drepMetadata,
}: {
  drepMetadata: BlockfrostDrepMetadata | null;
}) {
  if (!drepMetadata) {
    return (
      <p className="text-center text-gray-500">
        No metadata available for this DRep.
      </p>
    );
  }

  //  Extract Data using JSON-LD Helper
  const givenName = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.givenName,
  );
  const paymentAddress = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.paymentAddress,
  );
  const metadataHex = drepMetadata?.hex || "N/A";
  const metadataHash = drepMetadata?.hash || "N/A";
  const hashAlgorithm = extractJsonLdValue(
    drepMetadata?.json_metadata?.hashAlgorithm,
  );
  const imageUrl = drepMetadata?.json_metadata?.body?.image?.contentUrl || null;
  const objectives = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.objectives,
  );
  const motivations = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.motivations,
  );
  const qualifications = extractJsonLdValue(
    drepMetadata?.json_metadata?.body?.qualifications,
  );
  const references = drepMetadata?.json_metadata?.body?.references || [];
  const metadataBytes = drepMetadata?.bytes || "N/A";

  //  Categorize Links
  const socialMediaDomains = [
    "x.com",
    "twitter.com",
    "discord.gg",
    "instagram.com",
  ];
  const socialMediaLinks: Array<{ domain: string; url: string }> = [];
  const referenceLinks: Array<{ label: string; url: string }> = [];

  references.forEach((ref) => {
    const label = extractJsonLdValue(ref.label, "Unknown");
    let url = extractJsonLdValue(ref.uri, "#");
  
    //  Fix malformed URLs (prepend https:// if missing)
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
  
    try {
      const domain = new URL(url).hostname.replace(/^(www\.|m\.)/, "");
  
      if (socialMediaDomains.includes(domain)) {
        socialMediaLinks.push({ domain, url });
      } else {
        referenceLinks.push({ label, url });
      }
    } catch (error) {
      console.warn(`Invalid URL found: ${url}`, error);
    }
  });

  //  Icon Mapping for Social Media
  const iconMap: Record<string, JSX.Element> = {
    "x.com": <Twitter className="h-7 w-7 text-gray-200 hover:text-blue-400" />,
    "twitter.com": (
      <Twitter className="h-7 w-7 text-gray-200 hover:text-blue-400" />
    ),
    "discord.gg": (
      <svg
        className="h-7 w-7 text-gray-200 hover:text-blue-400"
        fill="currentColor"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"
          clipRule="evenodd"
        />
      </svg>
    ),
    "instagram.com": (
      <Instagram className="h-7 w-7 text-pink-500 hover:text-pink-400" />
    ),
    "github.com": (
      <svg
        className="h-7 w-7 text-gray-200 hover:text-blue-400"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  };

  return (
    <CardUI title="General Information">
      <div className="space-y-6">
        {/*  Objectives */}
        <div>
          <h3 className="text-lg font-semibold">Objectives</h3>
          <p>{objectives}</p>
        </div>

        {/*  Motivations */}
        <div>
          <h3 className="text-lg font-semibold">Motivations</h3>
          <p>{motivations}</p>
        </div>

        {/*  Qualifications */}
        <div>
          <h3 className="text-lg font-semibold">Qualifications</h3>
          <p>{qualifications}</p>
        </div>

        {/*  Social Media */}
        {socialMediaLinks.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold">Social Media</h3>
            <div className="flex space-x-4">
              {socialMediaLinks.map((social, index) => (
                <a
                  key={index}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {iconMap[social.domain] || (
                    <LinkIcon className="h-5 w-5 text-gray-400" />
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/*  References */}
        {referenceLinks.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold">References</h3>
            <ul className="list-disc space-y-2 pl-4">
              {referenceLinks.map((ref, index) => (
                <li key={index}>
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {ref.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*  Metadata Details */}
        <div >
          <h3 className="text-lg font-semibold">Metadata Details</h3>
          <p>
            <strong>Metadata Hex:</strong> {metadataHex}
          </p>
          <p>
            <strong>Metadata Hash:</strong> {metadataHash}
          </p>
          <p className="text-muted-foreground">
            <strong>Hash Algorithm:</strong> {hashAlgorithm}
          </p>
          <div className="text-muted-foreground">
            <strong>Raw Bytes:</strong>
            <div
              className="max-h-40 overflow-auto"
              style={{
                scrollbarWidth: "none", // Firefox
                msOverflowStyle: "none", // Internet Explorer 10+
              }}
            >
              <Code>{metadataBytes}</Code>
            </div>
          </div>
        </div>
      </div>
    </CardUI>
  );
}
