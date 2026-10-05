import type { GetServerSideProps } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { buildBotSetupGuide } from "@/lib/botSetupGuide";

// Match the blog's Markdown styling; this project has no typography plugin.
const GUIDE_STYLES =
  "max-w-none break-words text-sm leading-relaxed text-foreground " +
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight " +
  "[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold " +
  "[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1.5 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm " +
  "[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_table]:mt-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto " +
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left " +
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2";

type Props = {
  markdown: string;
};

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  return { props: { markdown: buildBotSetupGuide() } };
};

export default function BotSetupPage({ markdown }: Props) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Bot Setup</h1>
        <a
          className="text-sm underline text-muted-foreground"
          href="/api/v1/botSetupGuide"
        >
          Raw markdown (/api/v1/botSetupGuide)
        </a>
      </div>
      <article className={GUIDE_STYLES}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </main>
  );
}
