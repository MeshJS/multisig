import React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface ScriptIndicatorProps {
  hasScript: boolean;
}

const ScriptIndicator: React.FC<ScriptIndicatorProps> = ({ hasScript }) => {
  if (!hasScript) return null; // Do not render if the script is false

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <svg
          className="h-5 w-5 text-blue-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M9 18v-6l-2 2m6 4v-6l2 2m4 4V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2z"></path>
        </svg>
      </TooltipTrigger>
      <TooltipContent>This DRep uses a script-based voting mechanism.</TooltipContent>
    </Tooltip>
  );
};

export default ScriptIndicator;