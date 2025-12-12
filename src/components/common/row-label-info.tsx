import { useToast } from "@/hooks/use-toast";
import { Button } from "../ui/button";
import React from "react";

export default function RowLabelInfo({
  children,
  label,
  value,
  className,
  copyString,
  allowOverflow = false,
}: {
  children?: React.ReactNode;
  label?: string;
  value: string | React.ReactNode;
  className?: string;
  copyString?: string;
  allowOverflow?: boolean;
}) {
  const { toast } = useToast();
  // For mobile, stack vertically when allowOverflow is true (for long content like markdown)
  const isStacked = allowOverflow;
  
  return (
    <div className={`flex ${isStacked ? 'flex-col sm:flex-row' : 'flex-row'} ${isStacked ? 'items-start sm:items-center' : 'items-center'} gap-2 sm:gap-4`}>
      <div className={`flex ${isStacked ? 'flex-col w-full sm:flex-row sm:max-w-full' : 'max-w-full'} ${isStacked ? 'items-start sm:items-center justify-start sm:justify-center' : 'items-center justify-center'} gap-2`}>
        {label && (
          <div className={`text-nowrap text-xs sm:text-sm font-medium leading-none ${isStacked ? 'w-full sm:min-w-20' : 'min-w-20'} flex-shrink-0`}>
            {label}
          </div>
        )}
        {copyString ? (
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(copyString);
              toast({
                title: "Copied",
                description: "Address copied to clipboard",
                duration: 5000,
              });
            }}
            className="m-0 h-auto max-w-full justify-start truncate p-0 text-xs sm:text-sm"
          >
            <Value
              value={value}
              className={className}
              allowOverflow={allowOverflow}
            />
          </Button>
        ) : (
          <Value
            value={value}
            className={className}
            allowOverflow={allowOverflow}
          />
        )}
        {children && children}
      </div>
    </div>
  );
}

function Value({
  value,
  className,
  allowOverflow = false,
}: {
  value: string | React.ReactNode;
  className?: string;
  allowOverflow?: boolean;
}) {
  // When allowOverflow is true, allow text to wrap and break normally
  // When false, truncate with ellipsis
  const baseClasses = allowOverflow 
    ? "max-w-full w-full text-xs sm:text-sm text-muted-foreground break-words whitespace-normal"
    : "max-w-full overflow-hidden truncate whitespace-nowrap text-xs sm:text-sm text-muted-foreground";
  
  return (
    <div className={className || baseClasses}>
      {value}
    </div>
  );
}
