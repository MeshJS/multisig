import React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface ActiveIndicatorProps {
  isActive: boolean;
}

const ActiveIndicator: React.FC<ActiveIndicatorProps> = ({ isActive }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`h-3 w-3 rounded-full ${
            isActive ? "bg-green-500" : "bg-red-500"
          }`}
        />
      </TooltipTrigger>
      <TooltipContent>
        {isActive ? "This DRep is active in governance." : "This DRep is inactive."}
      </TooltipContent>
    </Tooltip>
  );
};

export default ActiveIndicator;