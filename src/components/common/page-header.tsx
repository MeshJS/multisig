import { ChevronLeft } from "lucide-react";
import { Button } from "../ui/button";

export default function PageHeader({
  children,
  pageTitle,
  backUrl,
}: {
  children?: React.ReactNode;
  pageTitle: string;
  backUrl?: string | undefined;
}) {
  return (
    <div className="flex items-center gap-4">
      {backUrl && (
        <Button variant="outline" size="icon" className="h-7 w-7">
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
      )}
      <h1 className="flex-1 shrink-0 whitespace-nowrap text-2xl font-semibold tracking-tight sm:grow-0">
        {pageTitle}
      </h1>
      <div className="ml-auto sm:ml-0"></div>
      <div className="hidden items-center gap-2 md:ml-auto md:flex">
        {children}
      </div>
    </div>
  );
}
