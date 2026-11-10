import Link from "next/link";
import { Button } from "@/components/ui/button";
import { gettingStartedSections } from "@/data/getting-started";
import useOnboardingPreference from "@/hooks/useOnboardingPreference";

export default function DashboardOnboarding({ address }: { address: string }) {
  const { ready, dismissed, setDismissed } = useOnboardingPreference(address);
  if (!ready) return null;
  return (
    <section
      aria-label="Getting started guide"
      className="rounded-lg border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Getting started with your wallet
        </h2>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={!dismissed}
          aria-controls="dashboard-onboarding-content"
          onClick={() => setDismissed(!dismissed)}
        >
          {dismissed
            ? "Show getting started guide"
            : "Dismiss getting started guide"}
        </Button>
      </div>
      <div id="dashboard-onboarding-content" hidden={dismissed}>
        <p className="mt-2 text-sm text-muted-foreground">
          Take these steps at your own pace. You can reopen this guide here or
          from Learn &amp; Help.
        </p>
        <ol className="mt-4 grid gap-4 lg:grid-cols-3">
          {gettingStartedSections
            .filter((section) => !section.optional)
            .map((section) => (
              <li key={section.id} className="min-w-0 space-y-1">
                <Link
                  href={`/getting-started#${section.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {section.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {section.summary}
                </p>
              </li>
            ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {gettingStartedSections
            .filter((section) => section.optional)
            .map((section) => (
              <Link
                key={section.id}
                href={`/getting-started#${section.id}`}
                className="underline underline-offset-4"
              >
                {section.title}
              </Link>
            ))}
          <Link
            href="/getting-started"
            className="underline underline-offset-4"
          >
            Read the full Getting Started guide
          </Link>
        </div>
      </div>
    </section>
  );
}
