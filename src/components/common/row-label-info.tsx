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
    <div className="flex items-center gap-4">
      <div className="flex max-w-full items-center justify-center gap-2">
        {label && (
          <div className="text-nowrap text-sm font-medium leading-none min-w-20">
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
            className="m-0 h-auto max-w-full justify-start truncate p-0"
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
  return (
    <div
      className={`${className ? className : `max-w-full ${allowOverflow ?? "overflow-hidden truncate whitespace-nowrap"} text-sm text-muted-foreground`}`}
    >
      {value}
    </div>
  );
}
