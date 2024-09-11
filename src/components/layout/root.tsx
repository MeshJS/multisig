export default function LayoutRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <main>{children}</main>
    </div>
  );
}
