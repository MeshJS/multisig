export default function Code({children}:{
  children: React.ReactNode;
}) {
  return (
    <pre className="break-all whitespace-pre-wrap p-2 text-sm text-muted-foreground">{children}</pre>
  )
};
