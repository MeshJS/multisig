// src/pages/api-docs.tsx
import dynamic from "next/dynamic";
import Globe from "./globe";

// Avoid SSR for Swagger UI
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });
import "swagger-ui-react/swagger-ui.css";

export default function ApiDocs() {
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
      <div
        style={{
          position: "relative",
          zIndex: 10,
          padding: "2rem",
          borderRadius: "12px",
          maxWidth: "100%",
          width: "calc(100% - 4rem)",
          margin: "2rem auto",
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
    </div>
  );
}
