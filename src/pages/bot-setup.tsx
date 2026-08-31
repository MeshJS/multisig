import type { GetServerSideProps } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  origin: string;
  markdown: string;
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const proto =
    (ctx.req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = ctx.req.headers.host ?? "multisig.meshjs.dev";
  const origin = `${proto}://${host}`;
  let markdown = "";
  try {
    const res = await fetch(`${origin}/api/v1/botSetupGuide`);
    markdown = await res.text();
  } catch (e) {
    markdown = `# Bot setup\n\nFailed to load guide: ${
      e instanceof Error ? e.message : "unknown error"
    }`;
  }
  return { props: { origin, markdown } };
};

export default function BotSetupPage({ origin, markdown }: Props) {
  const rawUrl = `${origin}/api/v1/botSetupGuide`;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Bot Setup</h1>
        <a
          className="text-sm underline text-muted-foreground"
          href={rawUrl}
        >
          Raw markdown ({rawUrl.replace(/^https?:\/\//, "")})
        </a>
      </div>
      <article className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </main>
  );
}
