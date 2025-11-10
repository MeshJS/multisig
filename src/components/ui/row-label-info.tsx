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
  return (
    <div className={`flex gap-4 ${allowOverflow ? 'flex-col sm:flex-row sm:items-start' : 'items-center'}`}>
      <div className={`flex max-w-full ${allowOverflow ? 'flex-col gap-1 flex-1 min-w-0' : 'items-center justify-center gap-2'}`}>
        {label && (
          <div className={`text-sm font-medium leading-none ${allowOverflow ? '' : 'text-nowrap min-w-20'}`}>
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
            className={`m-0 h-auto max-w-full justify-start p-0 ${allowOverflow ? '' : 'truncate'}`}
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
  const defaultClassName = allowOverflow
    ? "max-w-full break-all text-sm text-muted-foreground"
    : "max-w-full overflow-hidden truncate whitespace-nowrap text-sm text-muted-foreground";
  
  return (
    <div className={className || defaultClassName}>
      {value}
    </div>
  );
}
