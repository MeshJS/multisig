import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description: `# Multisig API Documentation

OpenAPI documentation for the Multisig API. This is in alpha stage and under active development. The endpoints are subject to change.

## Getting Started

### Authentication

Most endpoints require authentication using a Bearer token (JWT). To authenticate:

#### Option 1: Generate Token with Wallet (Recommended)

1. **Connect your wallet** to the application
2. Look for the **floating token generator button** in the **upper right corner** of this page
3. Click the button to **"Generate Token"** - this will:
   - Request a nonce from the API
   - Prompt you to sign the nonce with your connected wallet
   - Exchange the signature for a JWT token
   - Automatically authorize the token in Swagger UI
4. If successful, a **copyable token field** will appear above the button showing your generated token
5. You can **copy the token** using the copy button if needed
6. The token is automatically applied to all API requests

#### Option 2: Manual Token Entry

1. Click the **"Authorize"** button at the top right of this page (next to the scheme container)
2. Enter your JWT token in the format: \`Bearer <your-token>\` or just \`<your-token>\`
3. Click **"Authorize"** to apply the token to all requests
4. Click **"Close"** to close the authorization dialog

#### Token Generation Hints

- If your wallet is **not connected**, you'll see a hint in the upper right corner: "Connect wallet to generate token"
- Once connected, hover over the floating button to see the "Generate Token" option
- After generation, the token is displayed in a copyable field for your convenience

Your token will be automatically included in the \`Authorization\` header for all API requests.

### Using the API

1. **Browse Endpoints**: Expand the sections below to see available endpoints organized by tags (V1, Auth, etc.)

2. **View Details**: Click on any endpoint to see:
   - Request parameters (query, path, or body)
   - Request/response schemas
   - Example values
   - Response codes and descriptions

3. **Try It Out**: 
   - Click the **"Try it out"** button on any endpoint
   - Fill in the required parameters
   - Click **"Execute"** to send a real request to the API
   - View the response including status code, headers, and body

4. **Understand Responses**: 
   - Success responses (200, 201, etc.) show the expected data structure
   - Error responses (400, 401, 403, 500, etc.) show possible error scenarios

### API Base URL

All endpoints are relative to: \`/api\`

For example, \`/api/v1/nativeScript\` would be accessed at:
- Production: \`https://your-domain.com/api/v1/nativeScript\`
- Development: \`http://localhost:3000/api/v1/nativeScript\`

### Rate Limiting

Please be mindful of rate limits when testing endpoints. Excessive requests may result in temporary restrictions.

### Support

For issues or questions about the API, please refer to the main application documentation or contact support.`,
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: `# Authentication

This API uses **Bearer Token** authentication (JWT).

## Quick Start

**Option 1: Generate Token (Recommended)**
1. Connect your wallet
2. Use the floating token generator in the upper right corner
3. Click "Generate Token" and sign the nonce
4. Token is automatically authorized

**Option 2: Manual Entry**
1. Enter your token below: \`Bearer <your-token>\` or just \`<your-token>\`
2. Click "Authorize"`,
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
      "/api/v1/pendingTransactions": {
        get: {
          tags: ["V1"],
          summary: "Get pending transactions for a wallet",
          description:
            "Returns all pending multisig transactions awaiting signatures for the specified wallet and address.",
          parameters: [
            {
              in: "query",
              name: "walletId",
              required: true,
              schema: { type: "string" },
              description: "ID of the multisig wallet",
            },
            {
              in: "query",
              name: "address",
              required: true,
              schema: { type: "string" },
              description: "Address associated with the wallet (must match JWT)",
            },
          ],
          responses: {
            200: {
              description: "A list of pending transactions",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
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
            },
            400: { description: "Invalid address or walletId parameter" },
            401: { description: "Unauthorized or invalid token" },
            403: { description: "Address mismatch" },
            404: { description: "Wallet not found" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/signTransaction": {
        post: {
          tags: ["V1"],
          summary: "Sign an existing transaction",
          description:
            "Records a witness for an existing multisig transaction and optionally submits it if the signing threshold is met.",
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
                    signature: { type: "string" },
                    key: { type: "string" },
                    broadcast: { type: "boolean" },
                  },
                  required: [
                    "walletId",
                    "transactionId",
                    "address",
                    "signature",
                    "key",
                  ],
                },
              },
            },
          },
          responses: {
            200: {
              description:
                "Witness stored. Includes updated transaction and submission status.",
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
                      submitted: { type: "boolean" },
                      txHash: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
            401: { description: "Unauthorized or invalid signature" },
            403: { description: "Forbidden due to address mismatch or access" },
            404: { description: "Wallet or transaction not found" },
            409: {
              description:
                "Transaction already finalized or conflicting update detected",
            },
            502: {
              description:
                "Witness stored but submission to the network failed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
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
                      submitted: { type: "boolean" },
                      txHash: { type: "string", nullable: true },
                      submissionError: { type: "string" },
                    },
                  },
                },
              },
            },
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
