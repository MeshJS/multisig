import Link from "next/link";
// src/pages/api-docs.tsx
import dynamic from "next/dynamic";
import Head from "next/head";
import "swagger-ui-react/swagger-ui.css";
import React, { useEffect, useRef } from "react";
import { useGraphicsTier } from "@/hooks/useGraphicsTier";
import TokenGeneratorSlot from "@/components/pages/api-docs/token-generator-slot";
import type { SwaggerSystem } from "@/components/pages/api-docs/token-generator";

// Dynamic, not static: this pulls three.js + three-globe (~hundreds of KB) and
// most visitors never render it — the hardware tier decides. Keeping the static
// import shipped that payload to every device including the ones we then refuse
// to draw a globe on.
const Globe = dynamic(() => import("./globe"), { ssr: false, loading: () => null });

// Avoid SSR for Swagger UI.
//
// Its stylesheet (~186 KB) and our overrides (~122 KB) load on this page only.
// They used to be global imports in _app, which put 75% of the site's CSS on
// every page. CSS from node_modules may be imported from any module; our
// overrides are plain global CSS, which the Pages Router only allows in _app,
// so they are served from public/ and linked in this page's <Head>.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

/**
 * Add the "how to enter a token" hint next to Swagger UI's Authorize button.
 * Idempotent; called whenever Swagger UI may have (re)rendered its header.
 */
function addAuthInfo(): boolean {
  const schemeContainer = document.querySelector(".swagger-ui .scheme-container");
  if (schemeContainer && !schemeContainer.querySelector(".auth-info-text")) {
    const infoText = document.createElement("div");
    infoText.className = "auth-info-text";
    infoText.innerHTML = `
      <span class="auth-info-icon">ℹ️</span>
      <span class="auth-info-content">Enter your JWT token (format: <code>Bearer &lt;token&gt;</code> or just <code>&lt;token&gt;</code>)</span>
    `;
    schemeContainer.appendChild(infoText);
    return true;
  }
  return false;
}

export const getServerSideProps = () => ({ props: {} });

export default function ApiDocs() {
  // The globe is a three.js scene; only devices detected (and measured) as
  // capable get it. Everything else reads the docs over the plain background.
  const { features: gfx } = useGraphicsTier();
  // Swagger UI's system, for the token generator to authorize it with.
  const swaggerSystemRef = useRef<SwaggerSystem | null>(null);

  useEffect(() => {
    // Try immediately
    addAuthInfo();

    // Use MutationObserver to detect when Swagger UI loads
    const observer = new MutationObserver(() => {
      addAuthInfo();
    });

    // Observe the Swagger UI container
    const swaggerContainer = document.querySelector(".swagger-ui");
    if (swaggerContainer) {
      observer.observe(swaggerContainer, {
        childList: true,
        subtree: true,
      });
    }

    // Also try after delays as fallback
    const timer = setTimeout(addAuthInfo, 500);
    const timer2 = setTimeout(() => {
      addAuthInfo();
      observer.disconnect();
    }, 2000);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <Head>
        <link rel="stylesheet" href="/swagger-overrides.css" />
      </Head>
      {gfx.webglGlobe && (
        <div
          className="globe-background-container"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: -10,
            overflow: "hidden",
          }}
        >
          <Globe />
        </div>
      )}
      <div
        className="api-docs-wrapper"
        style={{
          position: "relative",
          zIndex: 10,
          padding: "2rem",
          borderRadius: "12px",
          maxWidth: "100%",
          width: "calc(100% - 4rem)",
          margin: "2rem auto",
          // A full-page backdrop-filter is one of the most expensive things a
          // compositor can be asked for, and there is nothing behind it to blur
          // unless the globe is rendering.
          backdropFilter: gfx.webglGlobe ? "blur(16px)" : undefined,
          WebkitBackdropFilter: gfx.webglGlobe ? "blur(16px)" : undefined,
        }}
      >
        <div className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            API &amp; Bot Documentation
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Build on Mesh Multisig with a typed REST API. List wallets, read
            pending transactions, and add or sign transactions from your own
            services and bots — the same endpoints the app itself uses.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/docs/mcp" className="underline underline-offset-4">
              Set up an AI client with MCP
            </Link>{" · "}
            <Link href="/about#developers-and-bots" className="underline underline-offset-4">
              Developers &amp; Bots
            </Link>
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Authenticate:</span>{" "}
              connect a wallet and use{" "}
              <span className="font-medium text-foreground">Generate Token</span>{" "}
              (bottom-right), or call{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                POST /api/v1/botAuth
              </code>{" "}
              for bots.
            </li>
            <li>
              <span className="font-medium text-foreground">Authorize:</span> send{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                Authorization: Bearer &lt;token&gt;
              </code>{" "}
              on each request.
            </li>
            <li>
              <span className="font-medium text-foreground">Machine spec:</span>{" "}
              fetch the OpenAPI JSON at{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                GET /api/swagger
              </code>
              .
            </li>
          </ul>
        </div>

        <SwaggerUI
          url="/api/swagger"
          docExpansion="none"
          defaultModelsExpandDepth={-1}
          deepLinking={true}
          onComplete={(system) => {
            // Store the Swagger UI system instance for programmatic access
            swaggerSystemRef.current = system as SwaggerSystem;
            // Swagger UI is a lazy chunk and fetches the spec, so it can
            // finish after the mount-time retries above have given up.
            setTimeout(addAuthInfo, 0);
          }}
        />
      </div>
      
      {/* Floating token generator — loads the wallet stack only when needed */}
      <TokenGeneratorSlot swaggerSystemRef={swaggerSystemRef} />
    </div>
  );
}
