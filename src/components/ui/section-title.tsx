export default function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="flex-1 shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
      {children}
    </h1>
  );
}
