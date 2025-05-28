// src/utils/swagger.ts
import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description: "OpenAPI documentation for the Multisig API. This is in alpha stage and under active developement. The endpoints are subject to change.",
    },
  },
  apis: ["./src/pages/api/v1/*.ts"], // Adjust to your API folder
});