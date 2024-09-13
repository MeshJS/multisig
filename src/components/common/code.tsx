export default function Code({children}:{
  children: React.ReactNode;
}) {
  return (
    <pre className="break-all whitespace-pre-wrap bg-muted p-2 text-sm">{children}</pre>
  )
};
