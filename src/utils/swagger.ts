import swaggerJSDoc from "swagger-jsdoc";

import { SITE_URL } from "@/lib/seo";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    // Absolute base URL so the spec is self-locating: tooling / codegen / LLMs
    // can resolve every path against the real deployment without extra config.
    servers: [
      {
        url: SITE_URL,
        description:
          "Deployment origin. All endpoints live under /api/v1 (e.g. <origin>/api/v1/botAuth).",
      },
    ],
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

Endpoints are rate limited per IP (and per bot for bot-authenticated calls, default 40/min). Every guarded response carries \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\`; a 429 additionally carries \`Retry-After\` (seconds). Space your requests and back off using these headers — rejected requests never extend the window.

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
      "/api/mcp": {
        post: {
          tags: ["MCP"],
          summary: "Model Context Protocol endpoint (stateless)",
          description:
            "A stateless MCP server for AI agents. One POST is one complete JSON-RPC exchange — there is no session, so GET and DELETE return 405. Serves both the 2026-07-28 and 2025-era protocol revisions.\n\nThe tool surface is read-only plus governance ballot drafts: it can list wallets, pending transactions, free UTxOs, proxies and active proposals, but cannot sign, spend or broadcast.\n\nAuthenticate with an OAuth 2.1 access token (discoverable via the `WWW-Authenticate` challenge on a 401) or an existing v1 bearer token. Full contract: src/pages/api/mcp/README.md.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "A JSON-RPC 2.0 request, e.g. tools/list or tools/call.",
                  properties: {
                    jsonrpc: { type: "string", example: "2.0" },
                    id: { type: "integer", example: 1 },
                    method: { type: "string", example: "tools/list" },
                    params: { type: "object" },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "JSON-RPC result",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
            401: {
              description:
                "Missing or invalid token. Carries a WWW-Authenticate header naming the RFC 9728 resource-metadata URL.",
            },
            403: { description: "Request carried an Origin header (browser-driven)" },
            405: { description: "Method Not Allowed — POST only" },
            429: { description: "Too many requests" },
          },
        },
      },
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
      "/api/v1/botStakeCertificate": {
        post: {
          tags: ["V1"],
          summary: "Build stake certificate transaction (SDK multisig)",
          description:
            "Server builds register/delegate/deregister stake transactions using Mesh (same as UI). Requires wallet signer JWT; bots need cosigner access and multisig:sign scope. Body must include utxoRefs (txHash + outputIndex) resolved from chain; use GET /api/v1/freeUtxos to pick inputs. poolId is required for delegate and register_and_delegate (bech32 pool1... or 56-char hex).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string", description: "Must match JWT address" },
                    action: {
                      type: "string",
                      enum: ["register", "deregister", "delegate", "register_and_delegate"],
                    },
                    poolId: { type: "string" },
                    utxoRefs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          txHash: { type: "string" },
                          outputIndex: { type: "integer" },
                        },
                        required: ["txHash", "outputIndex"],
                      },
                    },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "action", "utxoRefs"],
                },
              },
            },
          },
          responses: {
            201: { description: "Transaction created or submitted (same shape as addTransaction)" },
            400: { description: "Invalid input, wallet type, or staking not enabled" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botDRepCertificate": {
        post: {
          tags: ["V1"],
          summary: "Build DRep registration or retirement transaction",
          description:
            "Server builds DRep register/retire (non-proxy). Bots need multisig:sign. For register, anchorUrl and anchorJson are required; the server does not fetch anchorUrl and computes hashDrepAnchor from the provided anchorJson object. utxoRefs must list UTxOs at the multisig spend address.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string", description: "Must match JWT address" },
                    action: { type: "string", enum: ["register", "retire"] },
                    utxoRefs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          txHash: { type: "string" },
                          outputIndex: { type: "integer" },
                        },
                        required: ["txHash", "outputIndex"],
                      },
                    },
                    description: { type: "string" },
                    anchorUrl: { type: "string" },
                    anchorJson: { type: "object" },
                  },
                  required: ["walletId", "address", "action", "utxoRefs"],
                },
              },
            },
          },
          responses: {
            201: { description: "Transaction created or submitted" },
            400: { description: "Invalid input or unsupported wallet" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            405: { description: "Method not allowed" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/proxies": {
        get: {
          tags: ["V1", "Bot"],
          summary: "List active confirmed proxies for a wallet",
          description:
            "Returns active Proxy rows for a wallet. Human callers must be wallet signers. Bot callers may use observer or cosigner wallet access.",
          parameters: [
            { in: "query", name: "walletId", required: true, schema: { type: "string" } },
            {
              in: "query",
              name: "address",
              required: true,
              schema: { type: "string" },
              description: "Must match JWT address",
            },
          ],
          responses: {
            200: {
              description: "Active proxy records",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        walletId: { type: "string" },
                        proxyAddress: { type: "string" },
                        authTokenId: { type: "string" },
                        paramUtxo: { type: "string" },
                        description: { type: "string", nullable: true },
                        isActive: { type: "boolean" },
                        createdAt: { type: "string", format: "date-time" },
                        updatedAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden" },
            404: { description: "Wallet not found" },
          },
        },
      },
      "/api/v1/proxyDRepInfo": {
        get: {
          tags: ["V1", "Bot"],
          summary: "Get proxy DRep registration status",
          description:
            "Returns the on-chain active status for the DRep credential derived from a confirmed proxy. Human callers must be wallet signers. Bot callers may use observer or cosigner wallet access.",
          parameters: [
            { in: "query", name: "walletId", required: true, schema: { type: "string" } },
            {
              in: "query",
              name: "address",
              required: true,
              schema: { type: "string" },
              description: "Must match JWT address",
            },
            { in: "query", name: "proxyId", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Proxy DRep status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      active: { type: "boolean" },
                      dRepId: { type: "string" },
                    },
                    required: ["active", "dRepId"],
                  },
                },
              },
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden" },
            404: { description: "Wallet or proxy not found" },
            409: { description: "Stored proxy metadata mismatch" },
            500: { description: "Blockfrost or server error" },
          },
        },
      },
      "/api/v1/proxySetup": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Build a proxy setup transaction",
          description:
            "Builds a Plutus proxy setup transaction, persists it through the multisig pending transaction flow with no initial signed addresses, and returns derived setup metadata. Bots need multisig:sign and cosigner access. Proxy rows are not created until POST /api/v1/proxySetupFinalize validates confirmed chain state.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string", description: "Must match JWT address" },
                    utxoRefs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          txHash: { type: "string" },
                          outputIndex: { type: "integer" },
                        },
                        required: ["txHash", "outputIndex"],
                      },
                    },
                    collateralRef: {
                      type: "object",
                      properties: {
                        txHash: { type: "string" },
                        outputIndex: { type: "integer" },
                      },
                      required: ["txHash", "outputIndex"],
                    },
                    initialProxyLovelace: {
                      type: "string",
                      description:
                        "Optional positive integer lovelace amount to place at the proxy address during setup. Defaults to 1000000 when omitted.",
                      example: "5000000",
                    },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "utxoRefs", "collateralRef"],
                },
              },
            },
          },
          responses: {
            201: { description: "Pending/submitted transaction plus setup metadata" },
            400: { description: "Invalid input or UTxO refs" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            500: { description: "Build or persistence failure" },
          },
        },
      },
      "/api/v1/proxySetupFinalize": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Finalize a confirmed proxy setup",
          description:
            "Creates the confirmed Proxy row after setup is on-chain. The server validates that txHash created a proxy-address output and returned the auth token to the multisig wallet, then validates current chain state before creating or reactivating the row.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string", description: "Must match JWT address" },
                    txHash: {
                      type: "string",
                      description:
                        "Confirmed setup transaction hash. The transaction outputs must include the proxy address and the auth token at the multisig wallet address.",
                    },
                    proxyAddress: { type: "string" },
                    authTokenId: { type: "string" },
                    paramUtxo: {
                      type: "object",
                      properties: {
                        txHash: { type: "string" },
                        outputIndex: { type: "integer" },
                      },
                      required: ["txHash", "outputIndex"],
                    },
                    description: { type: "string" },
                  },
                  required: [
                    "walletId",
                    "address",
                    "txHash",
                    "proxyAddress",
                    "authTokenId",
                    "paramUtxo",
                  ],
                },
              },
            },
          },
          responses: {
            201: { description: "Confirmed Proxy row" },
            400: { description: "Missing metadata or chain validation failed" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Wallet not found" },
          },
        },
      },
      "/api/v1/proxySpend": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Build a proxy spend transaction",
          description:
            "Builds a proxy script spend transaction and persists it through the multisig pending transaction flow with no initial signed addresses. Requires an auth-token UTxO at the multisig wallet address. If proxyUtxoRefs is omitted, the server selects enough proxy-address UTxOs for the requested outputs plus fee buffer. Bots need multisig:sign and cosigner access.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string" },
                    proxyId: { type: "string" },
                    outputs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          address: { type: "string" },
                          unit: { type: "string" },
                          amount: { type: "string" },
                        },
                        required: ["address", "unit", "amount"],
                      },
                    },
                    utxoRefs: { type: "array", items: { type: "object" } },
                    proxyUtxoRefs: { type: "array", items: { type: "object" } },
                    collateralRef: { type: "object" },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "proxyId", "outputs", "utxoRefs", "collateralRef"],
                },
              },
            },
          },
          responses: {
            201: { description: "Transaction created or submitted" },
            400: { description: "Invalid input, UTxO refs, collateral, or missing auth token" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Proxy not found" },
            409: { description: "Stored proxy metadata mismatch" },
          },
        },
      },
      "/api/v1/proxyDRepCertificate": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Build a proxy DRep certificate transaction",
          description:
            "Registers, updates, or deregisters the proxy script DRep through the pending multisig flow with no initial signed addresses. The server computes hashDrepAnchor(anchorJson) for register/update and requires an auth-token UTxO. Bots need multisig:sign and cosigner access.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string" },
                    proxyId: { type: "string" },
                    action: { type: "string", enum: ["register", "update", "deregister"] },
                    utxoRefs: { type: "array", items: { type: "object" } },
                    collateralRef: { type: "object" },
                    anchorUrl: { type: "string" },
                    anchorJson: { type: "object" },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "proxyId", "action", "utxoRefs", "collateralRef"],
                },
              },
            },
          },
          responses: {
            201: { description: "Transaction created or submitted" },
            400: { description: "Invalid input, anchor payload, UTxO refs, or collateral" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Proxy not found" },
            409: { description: "Stored proxy metadata mismatch" },
          },
        },
      },
      "/api/v1/proxyVote": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Build a proxy DRep vote transaction",
          description:
            "Builds a governance vote as the proxy DRep through the pending multisig flow with no initial signed addresses. proposalId must use <txHash>#<certIndex>. Requires an auth-token UTxO. Bots need multisig:sign and cosigner access.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string" },
                    proxyId: { type: "string" },
                    votes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          proposalId: { type: "string" },
                          voteKind: { type: "string", enum: ["Yes", "No", "Abstain"] },
                          metadata: {},
                        },
                        required: ["proposalId", "voteKind"],
                      },
                    },
                    utxoRefs: { type: "array", items: { type: "object" } },
                    collateralRef: { type: "object" },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "proxyId", "votes", "utxoRefs", "collateralRef"],
                },
              },
            },
          },
          responses: {
            201: { description: "Transaction created or submitted" },
            400: { description: "Invalid input, proposal id, UTxO refs, or collateral" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Proxy not found" },
            409: { description: "Stored proxy metadata mismatch" },
          },
        },
      },
      "/api/v1/proxyCleanup": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Build a proxy cleanup transaction",
          description:
            "Builds the next safe cleanup transaction through the multisig pending transaction flow with no initial signed addresses. If the proxy address still has UTxOs, the transaction sweeps them back to the multisig wallet while preserving an auth token. Once the proxy address is empty, the transaction burns all auth tokens. Bots need multisig:sign and cosigner access. The Proxy row is deactivated only after POST /api/v1/proxyCleanupFinalize validates the confirmed burn transaction hash and current chain state.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string" },
                    proxyId: { type: "string" },
                    utxoRefs: { type: "array", items: { type: "object" } },
                    proxyUtxoRefs: {
                      type: "array",
                      items: { type: "object" },
                      description:
                        "Optional explicit proxy-address UTxOs to sweep. When provided, it must include every currently visible proxy UTxO.",
                    },
                    collateralRef: { type: "object" },
                    deactivateProxy: { type: "boolean", default: true },
                    description: { type: "string" },
                  },
                  required: ["walletId", "address", "proxyId", "utxoRefs", "collateralRef"],
                },
              },
            },
          },
          responses: {
            201: { description: "Pending/submitted cleanup transaction plus cleanup metadata" },
            400: { description: "Invalid input, UTxO refs, collateral, or auth-token count" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Proxy not found" },
            409: { description: "Stored proxy metadata mismatch" },
          },
        },
      },
      "/api/v1/proxyCleanupFinalize": {
        post: {
          tags: ["V1", "Bot"],
          summary: "Finalize a confirmed proxy cleanup",
          description:
            "Deactivates a Proxy row after cleanup is confirmed on-chain. The server validates that txHash spent the auth token without recreating it or a proxy-address output, then checks that auth tokens are no longer visible at the multisig wallet or proxy address and the proxy address has no remaining UTxOs.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    address: { type: "string" },
                    proxyId: { type: "string" },
                    txHash: {
                      type: "string",
                      description:
                        "Confirmed cleanup burn transaction hash. The transaction must spend the auth token without recreating auth-token or proxy-address outputs.",
                    },
                    deactivateProxy: { type: "boolean", default: true },
                  },
                  required: ["walletId", "address", "proxyId", "txHash"],
                },
              },
            },
          },
          responses: {
            201: { description: "Deactivated Proxy row" },
            400: { description: "Missing metadata or chain validation failed" },
            401: { description: "Unauthorized" },
            403: { description: "Forbidden or insufficient bot scope" },
            404: { description: "Proxy not found" },
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
          security: [],
          description:
            "Creates a pending bot registration and returns a claim code (valid 30 minutes) for a human owner to approve. New bots should initially register WITHOUT a paymentAddress — a fresh bot usually has no wallet yet; the address is bound at the bot's first POST /api/v1/botAuth instead.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 100 },
                    paymentAddress: {
                      type: "string",
                      minLength: 20,
                      description:
                        "Optional. Omit on first registration; the bot binds its address at first botAuth.",
                    },
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
                  required: ["name", "requestedScopes"],
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
          security: [],
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
          security: [],
          description:
            "Authenticate a bot key and return a bot JWT (valid ~1 hour; re-run botAuth to refresh — there is no separate refresh endpoint). botKeyId and secret are issued by the claim flow: POST /api/v1/botRegister -> human POST /api/v1/botClaim -> GET /api/v1/botPickupSecret. The secret can only be picked up ONCE but stays valid for repeated botAuth calls — store it securely. paymentAddress is required on the FIRST auth (it binds the bot's identity) and optional afterwards; the JWT always carries the server-side bound address, and a mismatching supplied address is rejected with 409.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    botKeyId: { type: "string", description: "Bot key ID from bot claim flow" },
                    secret: { type: "string", description: "Secret from botPickupSecret (one-time pickup, reusable for auth)" },
                    paymentAddress: {
                      type: "string",
                      description:
                        "Cardano payment address for this bot. Required on first auth (binds the address); optional afterwards and must match the bound address if provided.",
                    },
                    stakeAddress: { type: "string", description: "Optional stake address" },
                  },
                  required: ["botKeyId", "secret"],
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
            400: { description: "Missing or invalid botKeyId/secret, or paymentAddress missing on first auth" },
            401: { description: "Invalid bot key" },
            403: { description: "Insufficient scope" },
            409: {
              description:
                "paymentAddress does not match the address bound to this bot key, or is already registered to another bot",
            },
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
            "Returns the authenticated bot's own identity, owner address, and wallet grants (botWallets: [{walletId, walletName, role}]) so a bot can self-discover where it may read/write. Requires bot JWT.",
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
            "Returns active on-chain governance proposals. 'Active' means no terminal epoch (enacted/dropped/expired/ratified) has been stamped by the chain indexer — this can be a smaller set than explorer 'active' headers, which often still display ratified-but-not-enacted actions (outcome decided, enactment waiting for the epoch boundary) as open. Pass includeRatified=true to also get those boundary cases (status 'ratified'). The response includes currentEpoch so deadlines can be computed from details.expiration. Requires bot JWT and governance:read scope.",
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
              description:
                "Set true to include extra per-proposal details fields (expiration epoch, deposit, parameters — recommended for advisory bots).",
            },
            {
              in: "query",
              name: "includeRatified",
              required: false,
              schema: { type: "string", enum: ["true", "false"], default: "false" },
              description:
                "Set true to also include ratified-but-not-enacted proposals (status 'ratified') — the boundary cases explorers may still display as open.",
            },
          ],
          responses: {
            200: {
              description:
                "Proposals list plus paging echo, currentEpoch (null if unavailable), sourceCount and activeCount",
            },
            400: { description: "Invalid query parameter" },
            401: { description: "Unauthorized" },
            403: { description: "Insufficient scope or not a bot token" },
            503: { description: "Upstream governance provider rate limited (retryable)" },
            500: { description: "Internal server error" },
          },
        },
      },
      "/api/v1/botBallots": {
        get: {
          tags: ["V1", "Bot", "Governance"],
          summary: "List governance ballots on a granted wallet",
          description:
            "Read side of bot ballot drafting: returns every governance ballot (type=1) on the wallet so a bot can reconcile its drafts. Requires bot JWT, ballot:write scope, and any wallet grant (observer is enough).",
          parameters: [
            { in: "query", name: "walletId", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Ballot list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ballots: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            walletId: { type: "string" },
                            description: { type: "string", nullable: true },
                            items: { type: "array", items: { type: "string" } },
                            itemDescriptions: { type: "array", items: { type: "string" } },
                            choices: { type: "array", items: { type: "string" } },
                            rationaleComments: { type: "array", items: { type: "string" } },
                            createdAt: { type: "string", format: "date-time" },
                            updatedAt: { type: "string", format: "date-time" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: "walletId missing" },
            401: { description: "Unauthorized" },
            403: { description: "Not a bot token, missing ballot:write scope, or no wallet grant" },
            404: { description: "Wallet not found" },
            429: { description: "Too many requests" },
          },
        },
        delete: {
          tags: ["V1", "Bot", "Governance"],
          summary: "Delete a governance ballot draft",
          description:
            "Removes a governance ballot (type=1) from a granted wallet — lets bots clean up stale drafts without UI intervention. Same auth as GET.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: { type: "string" },
                    ballotId: { type: "string" },
                  },
                  required: ["walletId", "ballotId"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      deleted: { type: "boolean" },
                      ballotId: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing ids, wallet mismatch, or non-governance ballot" },
            401: { description: "Unauthorized" },
            403: { description: "Not permitted" },
            404: { description: "Wallet or ballot not found" },
            429: { description: "Too many requests" },
          },
        },
      },
      "/api/v1/botRotateSecret": {
        post: {
          tags: ["Auth", "Bot"],
          summary: "Rotate the bot key secret",
          security: [],
          description:
            "Proving possession of the current secret mints a replacement and invalidates the old one immediately. The new secret is returned exactly once — store it. Use this if a secret may have leaked; no re-registration needed. Strictly rate limited (5/min per IP).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    botKeyId: { type: "string" },
                    secret: { type: "string", description: "Current secret" },
                  },
                  required: ["botKeyId", "secret"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "New secret (returned once)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      botKeyId: { type: "string" },
                      secret: { type: "string" },
                    },
                  },
                },
              },
            },
            400: { description: "Missing botKeyId or secret" },
            401: { description: "Invalid bot key or secret" },
            429: { description: "Too many requests" },
          },
        },
      },
      "/api/v1/botBallotsUpsert": {
        post: {
          tags: ["V1", "Bot", "Governance"],
          summary: "Create or update governance ballots from bot decisions",
          description:
            "Upserts proposals and vote choices into a governance ballot (type=1). Bots may only submit rationaleComment drafts; anchorUrl/anchorHash are rejected. proposalIds are validated: txHash must be 64-char hex and the governance action must exist on-chain (unknown ids get a 400 listing them; indexer outages fail open). Upserts key on ballotId first, then exact ballotName match (409 if ambiguous), else a new dated ballot is created — the response carries created:true|false plus the full ballot (track ballot.id for later upserts and cleanup). Requires bot JWT, ballot:write scope, and any granted wallet access — observer is enough (drafts are unsigned advisory rows; the wallet owner grants access under User → Bot Management → Wallet access).",
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
