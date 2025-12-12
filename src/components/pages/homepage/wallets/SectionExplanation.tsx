import { Info } from "lucide-react";

interface SectionExplanationProps {
  description: string;
  className?: string;
}

export default function SectionExplanation({
  description,
  className = "",
}: SectionExplanationProps) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground ${className}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{description}</p>
    </div>
  );
}


