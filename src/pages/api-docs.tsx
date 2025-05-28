// src/pages/api-docs.tsx
import dynamic from "next/dynamic";

// Avoid SSR for Swagger UI
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });
import "swagger-ui-react/swagger-ui.css";

export default function ApiDocs() {
  return (
    <div style={{ height: "100vh" }}>
      <SwaggerUI url="/api/swagger" />
    </div>
  );
}