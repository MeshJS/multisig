import type { NextPageContext } from "next";

function Error({ statusCode }: { statusCode?: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
      <div className="w-full max-w-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm shadow-lg rounded-lg">
        <div className="flex flex-col items-center text-center p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
              {statusCode ?? "Error"}
            </h1>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {statusCode === 404 ? "Page Not Found" : "Something went wrong"}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
              {statusCode === 404
                ? "The page you're looking for doesn't exist or has been moved."
                : "An unexpected error has occurred."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 px-6 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Go Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
