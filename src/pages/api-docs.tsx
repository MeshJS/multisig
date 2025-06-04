// src/pages/api-docs.tsx
import dynamic from "next/dynamic";
import Globe from "./globe";
import { useEffect, useState } from "react";

// Avoid SSR for Swagger UI
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });
import "swagger-ui-react/swagger-ui.css";

export default function ApiDocs() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsLoaded(true);
    }, 500); // simulate short loading transition
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div style={{ minHeight: "100vh", position: "relative", color: "#f5f5f5" }}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -10,
          overflow: "hidden",
        }}
      >
        <Globe />
      </div>
      {!isLoaded ? (
        <div style={{ zIndex: 10, position: "relative", textAlign: "center", marginTop: "2rem" }}>
          <span style={{ fontSize: "1.25rem" }}>Loading API Docs...</span>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            borderRadius: "12px",
            maxWidth: "100%",
            width: "calc(100% - 4rem)",
            backdropFilter: "blur(16px)",
            backgroundColor: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            boxShadow: "0 4px 30px rgba(0, 0, 0, 0.3)",
          }}
        >
          <SwaggerUI
            url="/api/swagger"
            docExpansion="none"
            defaultModelsExpandDepth={-1}
            deepLinking={true}
          />
        </div>
      )}
    </div>
  );
}
