// src/utils/swagger.ts
import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description: "OpenAPI documentation for the Multisig API, similar to Blockfrost style",
    },
  },
  apis: ["./src/pages/api/v1/*.ts"], // Adjust to your API folder
});