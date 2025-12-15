export default function Code({children, className}:{
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <pre className={`break-all whitespace-pre-wrap p-3 sm:p-4 bg-muted/50 rounded-md border border-border/30 text-xs sm:text-sm text-muted-foreground font-mono overflow-x-auto ${className || ""}`}>{children}</pre>
  )
};
