import Link from "next/link";

export default function Custom404() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
      <div className="w-full max-w-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm shadow-lg rounded-lg">
        <div className="flex flex-col items-center text-center p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
              404
            </h1>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Page Not Found
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
              The page you&apos;re looking for doesn&apos;t exist or has been
              moved.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 px-6 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
