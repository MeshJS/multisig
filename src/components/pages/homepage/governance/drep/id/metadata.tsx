import React from "react";
import CardUI from "@/components/common/card-content";
import { BlockfrostDrepMetadata } from "@/types/governance";

export default function Metadata({ drepMetadata }: { drepMetadata: BlockfrostDrepMetadata | null }) {
  if (!drepMetadata) {
    return <p>No metadata available for this DRep.</p>;
  }

  const {
    url,
    hash,
    hex,
    json_metadata: {
      hashAlgorithm,
      body: {
        paymentAddress,
        givenName,
        image,
        objectives,
        motivations,
        qualifications,
        references,
      },
    },
    bytes,
  } = drepMetadata;

  return (
    <CardUI title="DRep Metadata">
      <div className="space-y-6">
        {/* General Information */}
        <div>
          <h3 className="text-lg font-semibold">General Information</h3>
          <p>
            <strong>Name:</strong> {givenName || "N/A"}
          </p>
          <p>
            <strong>Payment Address:</strong> {paymentAddress || "N/A"}
          </p>
          <p>
            <strong>Metadata URL:</strong>{" "}
            <a
              href={url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {url || "N/A"}
            </a>
          </p>
          <p>
            <strong>Metadata Hex:</strong> {hex || "N/A"}
          </p>
        </div>

        {/* Profile Picture */}
        {image && (
          <div>
            <h3 className="text-lg font-semibold">DRep Profile Picture</h3>
            <img
              src={image.contentUrl}
              alt="DRep"
              className="mt-2 h-32 w-32 rounded-full border"
            />
            <p>
              <strong>Image Hash:</strong> {image.sha256 || "N/A"}
            </p>
          </div>
        )}

        {/* Objectives */}
        <div>
          <h3 className="text-lg font-semibold">Objectives</h3>
          <p>{objectives || "No objectives provided."}</p>
        </div>

        {/* Motivations */}
        <div>
          <h3 className="text-lg font-semibold">Motivations</h3>
          <p>{motivations || "No motivations provided."}</p>
        </div>

        {/* Qualifications */}
        <div>
          <h3 className="text-lg font-semibold">Qualifications</h3>
          <p>{qualifications || "No qualifications provided."}</p>
        </div>

        {/* References */}
        {references && (
          <div>
            <h3 className="text-lg font-semibold">References</h3>
            <ul className="list-disc pl-6">
              {references.map((ref, index) => (
                <li key={index}>
                  <strong>{ref.label || "Unknown"}:</strong>{" "}
                  <a
                    href={ref.uri || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {ref.uri || "N/A"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Metadata Details */}
        <div>
          <h3 className="text-lg font-semibold">Metadata Details</h3>
          <p>
            <strong>Metadata Hash:</strong> {hash || "N/A"}
          </p>
          <p>
            <strong>Hash Algorithm:</strong> {hashAlgorithm || "N/A"}
          </p>
          <p>
            <strong>Raw Bytes:</strong>{" "}
            <textarea
              readOnly
              value={bytes || "N/A"}
              className="w-full bg-gray-100 p-2 text-sm font-mono border rounded"
            />
          </p>
        </div>
      </div>
    </CardUI>
  );
}