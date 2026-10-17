import { Html, Head, Main, NextScript } from "next/document";

/**
 * Match the OS colour scheme before first paint.
 *
 * The page is served with `class="dark"` and _app keeps it in sync after
 * hydration. Light routes now arrive server-rendered, so for a light-mode
 * visitor that gap was a visible flash of the dark theme. This runs before the
 * body paints and only touches the class; _app's listener still handles a
 * change while the page is open.
 */
const THEME_SCRIPT = `try{if(!window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.remove("dark")}}catch(e){}`;

export default function Document() {
  return (
    <Html lang="en" className="dark" suppressHydrationWarning>
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
