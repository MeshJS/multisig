import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description:
        "OpenAPI documentation for the Multisig API. This is in alpha stage and under active development. The endpoints are subject to change.",
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
    paths: {
      "/api/v1/nativeScript": {
        get: {
          tags: ["V1"],
          summary: "Get native scripts for a multisig wallet",
          description:
            "Returns native scripts generated from the specified walletId and address.",
          parameters: [
            {
              in: "query",
              name: "walletId",
              required: true,
              schema: {
                type: "string",
              },
              description: "ID of the multisig wallet",
            },
            {
              in: "query",
              name: "address",
              required: true,
              schema: {
                type: "string",
              },
              description: "Address associated with the wallet",
            },
          ],
          responses: {
            200: {
              description: "An array of native scripts",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid address or walletId parameter",
            },
            404: {
              description: "Wallet not found",
            },
            500: {
              description: "Internal server error",
            },
          },
        },
      },
      "/api/v1/freeUtxos": {
        get: {
          tags: ["V1"],
          summary: "Get unblocked UTxOs for a wallet",
          parameters: [
            {
              name: "walletId",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "address",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
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
                            outputIndex: { type: "number" },
                          },
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
                                  quantity: { type: "string" },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/addTransaction": {
        post: {
          tags: ["V1"],
          summary: "Submit a new external transaction",
          description:
            "Adds a new transaction for a multisig wallet, marking the caller's address as already signed.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    txCbor: { type: "string" },
                    txJson: { type: "string" },
                    description: { type: "string" },
                    address: { type: "string" },
                  },
                  required: ["walletId", "txCbor", "txJson", "address"],
                },
              },
            },
          },
          responses: {
            201: {
              description: "Transaction successfully created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      walletId: { type: "string" },
                      txJson: { type: "string" },
                      txCbor: { type: "string" },
                      signedAddresses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      rejectedAddresses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      description: { type: "string" },
                      state: { type: "number" },
                      createdAt: { type: "string" },
                      updatedAt: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing required fields" },
            401: { description: "Unauthorized" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/signTransaction": {
        post: {
          tags: ["V1"],
          summary: "Sign a pending multisig transaction",
          description:
            "Adds a signature to an existing multisig transaction and automatically submits it once the required signatures are met.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    transactionId: { type: "string" },
                    address: { type: "string" },
                    signedTx: { type: "string" },
                  },
                  required: [
                    "walletId",
                    "transactionId",
                    "address",
                    "signedTx",
                  ],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Transaction successfully updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      transaction: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          walletId: { type: "string" },
                          txJson: { type: "string" },
                          txCbor: { type: "string" },
                          signedAddresses: {
                            type: "array",
                            items: { type: "string" },
                          },
                          rejectedAddresses: {
                            type: "array",
                            items: { type: "string" },
                          },
                          description: { type: "string" },
                          state: { type: "number" },
                          txHash: { type: "string" },
                          createdAt: { type: "string" },
                          updatedAt: { type: "string" },
                        },
                      },
                      thresholdReached: { type: "boolean" },
                    },
                  },
                },
              },
            },
            400: { description: "Validation error" },
            401: { description: "Unauthorized" },
            403: { description: "Authorization error" },
            404: { description: "Wallet or transaction not found" },
            409: { description: "Signer already processed this transaction" },
            502: { description: "Blockchain submission failed" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/submitDatum": {
        post: {
          tags: ["V1"],
          summary: "Submit a new signable payload",
          description:
            "Adds a new signable payload for a multisig wallet, marking the caller's address as already signed.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    datum: { type: "string" },
                    description: { type: "string" },
                    address: { type: "string" },
                    callbackUrl: { type: "string" },
                    signature: { type: "string" },
                    key: { type: "string" },
                  },
                  required: [
                    "walletId",
                    "datum",
                    "address",
                    "signature",
                    "key",
                  ],
                },
              },
            },
          },
          responses: {
            201: {
              description: "Signable successfully created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      walletId: { type: "string" },
                      payload: { type: "string" },
                      signatures: {
                        type: "array",
                        items: { type: "string" },
                      },
                      signedAddresses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      rejectedAddresses: {
                        type: "array",
                        items: { type: "string" },
                      },
                      description: { type: "string" },
                      callbackUrl: { type: "string" },
                      remoteOrigin: { type: "string" },
                      state: { type: "number" },
                      createdAt: { type: "string" },
                      updatedAt: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing required fields" },
            401: { description: "Unauthorized" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/walletIds": {
        get: {
          tags: ["V1"],
          summary: "Get all wallet IDs and names associated with an address",
          description:
            "Returns a list of wallet identifiers and their names for a given user address.",
          parameters: [
            {
              in: "query",
              name: "address",
              required: true,
              schema: { type: "string" },
              description: "The address associated with the user's wallets",
            },
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
                        walletName: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid address parameter" },
            401: { description: "Unauthorized" },
            404: { description: "Wallets not found" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
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
              description:
                "Single Key Hash or comma-separated list of public key hashes",
              schema: {
                type: "string",
              },
            },
            {
              name: "network",
              in: "query",
              required: false,
              schema: {
                type: "number",
              },
            },
          ],
          responses: {
            200: {
              description: "A list of matching metadata items",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid pubKeyHashes parameter" },
            405: { description: "Method not allowed" },
            500: { description: "Internal Server Error" },
          },
        },
      },
      "/api/v1/getNonce": {
        get: {
          tags: ["Auth"],
          summary: "Request nonce for address-based authentication",
          parameters: [
            {
              name: "address",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Returns a nonce string to be signed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      nonce: { type: "string" },
                    },
                  },
                },
              },
            },
            400: {
              description: "Invalid address",
            },
            404: {
              description: "Address not found",
            },
          },
        },
      },
      "/api/v1/authSigner": {
        post: {
          tags: ["Auth"],
          summary: "Verify signed nonce and return bearer token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    address: { type: "string" },
                    signature: { type: "string" },
                    key: { type: "string" },
                  },
                  required: ["address", "signature", "key"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Returns a bearer token",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      token: { type: "string" },
                    },
                  },
                },
              },
            },
            400: {
              description: "Missing address or signature, or nonce not issued",
            },
            401: {
              description: "Invalid signature",
            },
          },
        },
      },
    },
  },
  apis: [],
});
