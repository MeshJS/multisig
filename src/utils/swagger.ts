import { OpenAPIV3 } from "openapi-types";

export const swaggerSpec: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: {
    title: "Multisig API",
    version: "1.0.0",
    description: "OpenAPI documentation for the Multisig API. This is in alpha stage and under active development. The endpoints are subject to change.",
  },
  paths: {
    "/api/v1/freeUtxos": {
      get: {
        tags: ["V1"],
        summary: "Get unblocked UTxOs for a wallet",
        parameters: [
          { name: "walletId", in: "query", required: true, schema: { type: "string" } },
          { name: "address", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "A list of free UTxOs",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      input: {
                        type: "object",
                        properties: {
                          txHash: { type: "string" },
                          outputIndex: { type: "number" }
                        }
                      },
                      output: {
                        type: "object",
                        properties: {
                          address: { type: "string" },
                          amount: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                unit: { type: "string" },
                                quantity: { type: "string" }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/walletIds": {
      get: {
        tags: ["V1"],
        summary: "Get all wallet IDs and names associated with an address",
        parameters: [
          { name: "address", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "A list of wallet ID-name pairs",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      walletId: { type: "string" },
                      walletName: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/nativeScript": {
      get: {
        tags: ["V1"],
        summary: "Get native scripts for a multisig wallet",
        parameters: [
          { name: "walletId", in: "query", required: true, schema: { type: "string" } },
          { name: "address", in: "query", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "An array of native scripts",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/lookupMultisigWallet": {
      get: {
        tags: ["V1"],
        summary: "Lookup multisig wallet metadata using pubKeyHashes",
        parameters: [
          {
            name: "pubKeyHashes",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Single Key Hash or comma-separated list of hashes"
          },
          {
            name: "network",
            in: "query",
            required: false,
            schema: { type: "number" }
          }
        ],
        responses: {
          200: {
            description: "A list of matching metadata items",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { type: "object" }
                }
              }
            }
          }
        }
      }
    }
  }
};