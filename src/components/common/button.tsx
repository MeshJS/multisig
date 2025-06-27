import { Button as ShadcnButton } from "@/components/ui/button";
import { Loader } from "lucide-react";
import { useState } from "react";

export default function Button({
  children,
  onClick,
  disabled = false,
  loading,
  className,
  variant,
  size,
  asChild,
  hold,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  variant?:
    | "default"
    | "link"
    | "secondary"
    | "destructive"
    | "outline"
    | "ghost"
    | null
    | undefined;
  size?: "default" | "sm" | "lg" | "icon" | null | undefined;
  asChild?: boolean | undefined;
  hold?: number;
}) {
  const [holding, setHolding] = useState<boolean>(false);
  const [curTime, setCurTime] = useState<number>(0);

  return (
    <ShadcnButton
      variant={variant}
      onClick={hold === undefined ? onClick : undefined}
      disabled={disabled}
      size={size}
      className={className}
      asChild={asChild}
      onMouseDown={
        hold
          ? (e) => {
              e.preventDefault();
              setHolding(true);
              setCurTime(Date.now());
              const holdTimer = setTimeout(() => {
                setHolding(false);
                if (onClick) {
                  onClick();
                }
              }, hold);
              (e.target as HTMLElement).onmouseup = () => {
                setHolding(false);
                clearTimeout(holdTimer);
              };
            }
          : undefined
      }
    >
      {loading && <Loader className="h-4 w-4 animate-spin mr-2" />}
      {children}
      {hold &&
        holding &&
        ` (Hold for ${Math.round((hold - (Date.now() - curTime)) / 1000)} secs)`}
    </ShadcnButton>
  );
}
