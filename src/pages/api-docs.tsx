// src/pages/api-docs.tsx
import dynamic from "next/dynamic";
import Globe from "./globe";
import Head from "next/head";

// Avoid SSR for Swagger UI
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function ApiDocs() {
  return (
    <>
      <Head>
        <title>API Documentation - Multisig</title>
        <meta name="description" content="OpenAPI documentation for the Multisig API" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <div style={{ minHeight: "100vh", position: "relative", color: "#f5f5f5" }}>
        {/* Background Globe */}
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
        
        {/* Main Content Container */}
        <div
          style={{
            position: "relative",
            zIndex: 10,
            padding: "1rem",
            maxWidth: "1400px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          {/* Header Section */}
          <div
            style={{
              textAlign: "center",
              marginBottom: "2rem",
              padding: "2rem 1rem",
            }}
          >
            <h1
              style={{
                fontSize: "3rem",
                fontWeight: "700",
                color: "#f5f5f5",
                marginBottom: "1rem",
                textShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
              }}
            >
              API Documentation
            </h1>
            <p
              style={{
                fontSize: "1.2rem",
                color: "#d1d5db",
                maxWidth: "600px",
                margin: "0 auto",
                lineHeight: "1.6",
              }}
            >
              Explore the Multisig API endpoints with interactive documentation
            </p>
          </div>
          
          {/* Swagger UI Container */}
          <div
            style={{
              borderRadius: "16px",
              overflow: "hidden",
              backdropFilter: "blur(20px)",
              backgroundColor: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: "0 8px 40px rgba(0, 0, 0, 0.2)",
            }}
          >
            <SwaggerUI
              url="/api/swagger"
              docExpansion="none"
              defaultModelsExpandDepth={-1}
              deepLinking={true}
              tryItOutEnabled={true}
              supportedSubmitMethods={["get", "post"]}
              requestInterceptor={(request) => {
                // Add any request interceptors here if needed
                return request;
              }}
              responseInterceptor={(response) => {
                // Add any response interceptors here if needed
                return response;
              }}
            />
          </div>
          
          {/* Footer Section */}
          <div
            style={{
              textAlign: "center",
              marginTop: "3rem",
              padding: "2rem 1rem",
              color: "#94a3b8",
              fontSize: "0.9rem",
            }}
          >
            <p>
              This API documentation is generated using OpenAPI 3.0 specification
            </p>
            <p style={{ marginTop: "0.5rem" }}>
              For support or questions, please refer to the project documentation
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
