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
      "/api/v1/botRegister": {
        post: {
          tags: ["Auth", "Bot"],
          summary: "Self-register a bot for human claim approval",
          description:
            "Creates a pending bot registration and returns a short-lived claim code for a human owner to approve.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 100 },
                    paymentAddress: { type: "string", minLength: 20 },
                    stakeAddress: { type: "string" },
                    requestedScopes: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: [
                          "multisig:read",
                          "multisig:create",
                          "multisig:sign",
                          "governance:read",
                          "ballot:write",
                        ],
                      },
                      minItems: 1,
                    },
                  },
                  required: ["name", "paymentAddress", "requestedScopes"],
                },
              },
            },
          },
          responses: {
            201: {
              description: "Pending bot created; claim code issued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      pendingBotId: { type: "string" },
                      claimCode: { type: "string" },
                      claimExpiresAt: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid registration payload" },
            405: { description: "Method not allowed" },
            409: { description: "Address already registered" },
            429: { description: "Too many requests" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botClaim": {
        post: {
          tags: ["Auth", "Bot"],
          summary: "Claim a pending bot as a human user",
          description:
            "Requires a human JWT. Verifies claim code, creates bot credentials, and links ownership to the claimer.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    pendingBotId: { type: "string" },
                    claimCode: { type: "string", minLength: 24 },
                    approvedScopes: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: [
                          "multisig:read",
                          "multisig:create",
                          "multisig:sign",
                          "governance:read",
                          "ballot:write",
                        ],
                      },
                    },
                  },
                  required: ["pendingBotId", "claimCode"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Bot claimed and credentials minted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      botKeyId: { type: "string" },
                      botId: { type: "string" },
                      name: { type: "string" },
                      scopes: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid claim payload" },
            401: { description: "Unauthorized (human JWT required)" },
            404: { description: "Pending bot not found or expired" },
            405: { description: "Method not allowed" },
            409: { description: "Invalid claim code, already claimed, or claim locked" },
            429: { description: "Too many requests" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botPickupSecret": {
        get: {
          tags: ["Auth", "Bot"],
          summary: "Retrieve one-time bot secret after claim",
          description:
            "Returns bot credentials exactly once after a successful claim. Requires pendingBotId query parameter.",
          parameters: [
            {
              in: "query",
              name: "pendingBotId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "One-time bot secret",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      botKeyId: { type: "string" },
                      secret: { type: "string" },
                      paymentAddress: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid pendingBotId" },
            404: { description: "Pending bot not found or not yet claimed" },
            405: { description: "Method not allowed" },
            410: { description: "Secret already picked up" },
            429: { description: "Too many requests" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botAuth": {
        post: {
          tags: ["Auth", "Bot"],
          summary: "Bot authentication",
          description:
            "Authenticate a bot key and return a bot JWT. botKeyId and secret are issued by the claim flow: POST /api/v1/botRegister -> human POST /api/v1/botClaim -> GET /api/v1/botPickupSecret.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    botKeyId: { type: "string", description: "Bot key ID from bot claim flow" },
                    secret: { type: "string", description: "One-time secret from botPickupSecret" },
                    paymentAddress: { type: "string", description: "Cardano payment address for this bot" },
                    stakeAddress: { type: "string", description: "Optional stake address" },
                  },
                  required: ["botKeyId", "secret", "paymentAddress"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Returns JWT and bot ID",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      token: { type: "string" },
                      botId: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing or invalid botKeyId, secret, or paymentAddress" },
            401: { description: "Invalid bot key" },
            403: { description: "Insufficient scope" },
            409: { description: "paymentAddress already registered to another bot" },
            405: { description: "Method not allowed" },
            429: { description: "Too many requests" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botMe": {
        get: {
          tags: ["V1", "Bot"],
          summary: "Get authenticated bot profile",
          description:
            "Returns the authenticated bot's own identity and owner address. Requires bot JWT.",
          responses: {
            200: {
              description: "Bot profile",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      botId: { type: "string" },
                      paymentAddress: { type: "string" },
                      displayName: { type: "string", nullable: true },
                      botName: { type: "string" },
                      ownerAddress: { type: "string" },
                    },
                  },
                },
              },
            },
            401: { description: "Missing/invalid token" },
            403: { description: "Not a bot token" },
            404: { description: "Bot not found" },
            405: { description: "Method not allowed" },
            429: { description: "Too many requests" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/createWallet": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Create multisig wallet with bot JWT",
          description:
            "Creates a multisig wallet from signer payment/stake/DRep inputs. Requires bot JWT and multisig:create scope.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 256 },
                    description: {
                      type: "string",
                      description: "Optional free text. Server stores at most 2000 chars.",
                      maxLength: 2000,
                    },
                    signersAddresses: {
                      type: "array",
                      items: { type: "string" },
                      minItems: 1,
                      description: "Cardano payment addresses used to derive payment key hashes.",
                    },
                    signersDescriptions: {
                      type: "array",
                      items: { type: "string" },
                      description: "Optional per-signer labels. Missing entries default to an empty string.",
                    },
                    signersStakeKeys: {
                      type: "array",
                      items: {
                        oneOf: [{ type: "string" }, { type: "null" }],
                      },
                      description:
                        "Optional stake addresses. Ignored when stakeCredentialHash is provided.",
                    },
                    signersDRepKeys: {
                      type: "array",
                      items: {
                        oneOf: [{ type: "string" }, { type: "null" }],
                      },
                      description: "Optional DRep key hashes (non-empty values are used as provided).",
                    },
                    numRequiredSigners: {
                      type: "integer",
                      minimum: 1,
                      default: 1,
                      description:
                        "Used for atLeast scripts. Values above signer count are clamped to signer count.",
                    },
                    scriptType: {
                      type: "string",
                      enum: ["atLeast", "all", "any"],
                      default: "atLeast",
                      description: "Unknown values are treated as atLeast.",
                    },
                    paymentNativeScript: {
                      type: "object",
                      description:
                        "Optional explicit payment script tree. Supported nodes: sig/all/any/atLeast. Sig key hashes must match signersAddresses payment key hashes.",
                      example: {
                        type: "all",
                        scripts: [
                          {
                            type: "atLeast",
                            required: 2,
                            scripts: [
                              {
                                type: "sig",
                                keyHash: "b8b7d19e...7776dfde7",
                              },
                              {
                                type: "sig",
                                keyHash: "f4755fe1...0c91faa1",
                              },
                              {
                                type: "sig",
                                keyHash: "59d8f3f9...bd3360762",
                              },
                            ],
                          },
                        ],
                      },
                    },
                    stakeCredentialHash: { type: "string" },
                    network: { type: "integer", enum: [0, 1], default: 1 },
                  },
                  required: ["name", "signersAddresses"],
                },
              },
            },
          },
          responses: {
            201: {
              description: "Wallet created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      walletId: { type: "string" },
                      address: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid payload or signer data" },
            401: { description: "Missing/invalid token or bot not found" },
            403: { description: "Not a bot token or insufficient scope" },
            405: { description: "Method not allowed" },
            429: { description: "Too many requests" },
            500: { description: "Failed to create wallet" },
          },
        },
      },
      "/api/v1/governanceActiveProposals": {
        get: {
          tags: ["V1", "Bot", "Governance"],
          summary: "List active governance proposals for bots",
          description:
            "Returns active on-chain governance proposals only (enacted/dropped/expired/ratified are filtered out). Requires bot JWT and governance:read scope.",
          parameters: [
            {
              in: "query",
              name: "network",
              required: false,
              schema: { type: "string", enum: ["0", "1"], default: "1" },
              description: "0 = preprod, 1 = mainnet",
            },
            {
              in: "query",
              name: "count",
              required: false,
              schema: { type: "integer", default: 100, minimum: 1, maximum: 100 },
            },
            {
              in: "query",
              name: "page",
              required: false,
              schema: { type: "integer", default: 1, minimum: 1 },
            },
            {
              in: "query",
              name: "order",
              required: false,
              schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
            },
            {
              in: "query",
              name: "details",
              required: false,
              schema: { type: "string", enum: ["true", "false"], default: "false" },
              description: "Set true to include extra per-proposal details fields.",
            },
          ],
          responses: {
            200: {
              description: "Active proposals list (after active-status filtering)",
            },
            400: { description: "Invalid query parameter" },
            401: { description: "Unauthorized" },
            403: { description: "Insufficient scope or not a bot token" },
            503: { description: "Upstream governance provider rate limited (retryable)" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botBallotsUpsert": {
        post: {
          tags: ["V1", "Bot", "Governance"],
          summary: "Create or update governance ballots from bot decisions",
          description:
            "Upserts proposals and vote choices into a governance ballot (type=1). Bots may only submit rationaleComment drafts; anchorUrl/anchorHash are rejected. Requires bot JWT, ballot:write scope, and cosigner wallet access.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    ballotId: { type: "string" },
                    ballotName: { type: "string" },
                    proposals: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          proposalId: { type: "string", description: "<txHash>#<certIndex>" },
                          proposalTitle: { type: "string" },
                          choice: { type: "string", enum: ["Yes", "No", "Abstain"] },
                          rationaleComment: { type: "string" },
                        },
                        required: ["proposalId", "proposalTitle", "choice"],
                      },
                    },
                  },
                  required: ["walletId", "proposals"],
                },
              },
            },
          },
          responses: {
            200: { description: "Ballot upserted successfully" },
            400: { description: "Invalid payload or non-governance ballot mutation attempt" },
            401: { description: "Unauthorized" },
            403: { description: "Insufficient scope or wallet mutation access denied" },
            404: { description: "Ballot not found when ballotId is provided" },
            409: { description: "Ambiguous ballotName or concurrent write conflict" },
            500: { description: "Internal server error" },
          },
        },
      },
    },
  },
  apis: [],
});
