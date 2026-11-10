import Link from "next/link";
import { gettingStartedSections } from "@/data/getting-started";
import { isLightHref } from "@/lib/wallet-runtime";
import RestoreOnboarding from "@/components/common/onboarding/restore-onboarding";

export default function GettingStarted() {
  return (
    <article className="mx-auto w-full max-w-3xl space-y-8 py-6">
      <header>
        <h1 className="text-3xl font-bold">Getting Started</h1>
        <p className="mt-3 text-muted-foreground">
          Set up a shared Cardano wallet with your team. Read this guide before
          connecting a wallet and return to it from Learn &amp; Help at any
          time.
        </p>
      </header>
      <RestoreOnboarding />
      {gettingStartedSections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="scroll-mt-4 space-y-3"
        >
          <h2 className="text-xl font-semibold">{section.title}</h2>
          <p>{section.body}</p>
          {section.links.length > 0 && (
            <div className="flex flex-wrap gap-4 underline underline-offset-4">
              {section.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={isLightHref(link.href) ? undefined : false}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </article>
  );
}
