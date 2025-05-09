import React from "react";
import CardUI from "@/components/ui/card-content";
import { BlockfrostDrepInfo } from "@/types/governance";

export default function BaseData({ drepInfo }: { drepInfo: BlockfrostDrepInfo | null }) {
  if (!drepInfo) {
    return <p>No information available for this DRep.</p>;
  }

  return (
    <CardUI title="DRep Overview">
      <div className="space-y-4">
        <p>
          <strong>ID:</strong> {drepInfo.drep_id}
        </p>
        <p>
          <strong>Hex:</strong> {drepInfo.hex || "N/A"}
        </p>
        <p>
          <strong>Active:</strong> {drepInfo.active ? "Yes" : "No"}
        </p>
        <p>
          <strong>Active Epoch:</strong> {drepInfo.active_epoch || "N/A"}
        </p>
        <p>
          <strong>Balance:</strong> {drepInfo.amount || "N/A"} ADA
        </p>
        <p>
          <strong>Has Script:</strong> {drepInfo.has_script ? "Yes" : "No"}
        </p>
      </div>
    </CardUI>
  );
}