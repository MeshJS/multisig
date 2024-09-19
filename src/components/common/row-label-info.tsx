import { useToast } from "@/hooks/use-toast";
import { Button } from "../ui/button";
import React from "react";

export default function RowLabelInfo({
  label,
  value,
  className,
  copyString,
}: {
  label?: string;
  value: string | React.ReactNode;
  className?: string;
  copyString?: string;
}) {
  const { toast } = useToast();

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center justify-center gap-2 max-w-full">
        {label && <p className="text-sm font-medium leading-none">{label}</p>}
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
            className="m-0 h-auto justify-start truncate p-0 max-w-full"
          >
            <Value value={value} className={className} />
          </Button>
        ) : (
          <Value value={value} className={className} />
        )}
      </div>
    </div>
  );
}

function Value({
  value,
  className,
}: {
  value: string | React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`${className ? className : "text-sm text-muted-foreground truncate overflow-hidden whitespace-nowrap max-w-full"}`}>
      {value}
    </p>
  );
}
