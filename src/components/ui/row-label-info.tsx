import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "../ui/button";
import { Check, Copy } from "lucide-react";
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
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!copyString) return;
    navigator.clipboard.writeText(copyString);
    setCopied(true);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
      duration: 3000,
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-4 ${allowOverflow ? 'flex-col sm:flex-row sm:items-start' : 'items-center'}`}>
      <div className={`flex max-w-full ${allowOverflow ? 'flex-col gap-1 flex-1 min-w-0' : 'items-center justify-center gap-2'}`}>
        {label && (
          <div className={`text-sm font-medium leading-none ${allowOverflow ? '' : 'text-nowrap min-w-20'} text-muted-foreground`}>
            {label}
          </div>
        )}
        {copyString ? (
          // Explicit copy icon (with copy→check feedback) next to the value,
          // matching the affordance used in the signers list.
          <div className="flex min-w-0 items-center gap-1">
            <Value
              value={value}
              className={className}
              allowOverflow={allowOverflow}
              mono
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              aria-label="Copy to clipboard"
              className="h-7 w-7 flex-shrink-0 p-0"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
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
  mono = false,
}: {
  value: string | React.ReactNode;
  className?: string;
  allowOverflow?: boolean;
  mono?: boolean;
}) {
  const defaultClassName = `${
    allowOverflow
      ? "max-w-full break-all"
      : "max-w-full overflow-hidden truncate whitespace-nowrap"
  } text-sm text-muted-foreground${mono ? " font-mono" : ""}`;

  return (
    <div className={className || defaultClassName}>
      {value}
    </div>
  );
}
