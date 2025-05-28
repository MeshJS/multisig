import swaggerJSDoc from "swagger-jsdoc";
import path from "path";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description: "OpenAPI documentation for the Multisig API. This is in alpha stage and under active development. The endpoints are subject to change.",
    },
  },
  apis: [path.resolve(process.cwd(), "src/pages/api/v1/*.ts")],
});