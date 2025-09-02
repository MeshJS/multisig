import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Multisig API",
      version: "1.0.0",
      description: `
# Multisig API Documentation

A comprehensive API for managing multisignature wallets on the Cardano blockchain. This API provides endpoints for creating, managing, and interacting with multisig wallets, including transaction signing, UTXO management, and wallet operations.

## Features

- **Wallet Management**: Create and manage multisignature wallets
- **Transaction Handling**: Submit and sign transactions with multiple parties
- **UTXO Management**: Track and manage unspent transaction outputs
- **Authentication**: Secure address-based authentication with cryptographic signatures
- **Real-time Updates**: Monitor wallet states and transaction statuses

## Authentication

The API uses address-based authentication where users sign a nonce with their private key to obtain a bearer token. This token must be included in the Authorization header for protected endpoints.


## Support

For questions or support, please refer to the project documentation or create an issue in the repository.
      `,
      contact: {
        name: "Multisig API Support",
        url: "https://github.com/MeshJS/multisig",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "https://multisig.meshjs.dev",
        description: "Production server",
      },
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained from the /api/v1/getNonce and /api/v1/authSigner endpoints",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description: "Error message",
              example: "Invalid wallet ID provided",
            },
            code: {
              type: "string",
              description: "Error code for programmatic handling",
              example: "INVALID_WALLET_ID",
            },
            details: {
              type: "object",
              description: "Additional error details",
            },
          },
          required: ["error"],
        },
        Wallet: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique wallet identifier",
              example: "wallet_1234567890abcdef",
            },
            name: {
              type: "string",
              description: "Human-readable wallet name",
              example: "Team Treasury Wallet",
            },
            description: {
              type: "string",
              description: "Optional wallet description",
              example: "Main treasury wallet for team operations",
            },
            requiredSignatures: {
              type: "integer",
              description: "Number of signatures required for transactions",
              minimum: 1,
              example: 3,
            },
            totalSigners: {
              type: "integer",
              description: "Total number of authorized signers",
              example: 5,
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Wallet creation timestamp",
              example: "2024-01-15T10:30:00Z",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              description: "Last update timestamp",
              example: "2024-01-15T15:45:00Z",
            },
          },
          required: ["id", "name", "requiredSignatures", "totalSigners", "createdAt"],
        },
        Transaction: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique transaction identifier",
              example: "tx_1234567890abcdef",
            },
            walletId: {
              type: "string",
              description: "Associated wallet ID",
              example: "wallet_1234567890abcdef",
            },
            txHash: {
              type: "string",
              description: "Cardano transaction hash",
              example: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
            },
            description: {
              type: "string",
              description: "Human-readable transaction description",
              example: "Payment to vendor for services",
            },
            amount: {
              type: "object",
              properties: {
                lovelace: {
                  type: "string",
                  description: "Amount in lovelace (1 ADA = 1,000,000 lovelace)",
                  example: "10000000",
                },
                ada: {
                  type: "number",
                  description: "Amount in ADA",
                  example: 10.0,
                },
              },
            },
            status: {
              type: "string",
              enum: ["pending", "signed", "submitted", "confirmed", "failed"],
              description: "Current transaction status",
              example: "pending",
            },
            signedAddresses: {
              type: "array",
              items: {
                type: "string",
              },
              description: "List of addresses that have signed",
              example: ["addr1qxck...", "addr1qyck..."],
            },
            requiredSignatures: {
              type: "integer",
              description: "Number of signatures required",
              example: 3,
            },
            createdAt: {
              type: "string",
              format: "date-time",
              example: "2024-01-15T10:30:00Z",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              example: "2024-01-15T15:45:00Z",
            },
          },
          required: ["id", "walletId", "description", "status", "requiredSignatures"],
        },
        UTXO: {
          type: "object",
          properties: {
            txHash: {
              type: "string",
              description: "Transaction hash containing this UTXO",
              example: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
            },
            outputIndex: {
              type: "integer",
              description: "Output index within the transaction",
              example: 0,
            },
            address: {
              type: "string",
              description: "Address that owns this UTXO",
              example: "addr1qxck...",
            },
            amount: {
              type: "object",
              properties: {
                lovelace: {
                  type: "string",
                  description: "Amount in lovelace",
                  example: "10000000",
                },
                ada: {
                  type: "number",
                  description: "Amount in ADA",
                  example: 10.0,
                },
              },
            },
            assets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  policyId: {
                    type: "string",
                    description: "Asset policy ID",
                    example: "a1b2c3d4e5f6789012345678901234567890abcdef",
                  },
                  assetName: {
                    type: "string",
                    description: "Asset name (hex encoded)",
                    example: "546f6b656e",
                  },
                  quantity: {
                    type: "string",
                    description: "Asset quantity",
                    example: "1000",
                  },
                },
              },
            },
            datumHash: {
              type: "string",
              description: "Optional datum hash if UTXO contains datum",
              example: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
            },
          },
          required: ["txHash", "outputIndex", "address", "amount"],
        },
        NativeScript: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["ScriptPubkey", "ScriptAll", "ScriptAny", "ScriptNOfK"],
              description: "Type of native script",
              example: "ScriptAll",
            },
            script: {
              type: "object",
              description: "Script content (varies by type)",
            },
            cbor: {
              type: "string",
              description: "CBOR representation of the script",
              example: "d8799f581c...",
            },
          },
          required: ["type", "script", "cbor"],
        },
        AuthRequest: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Cardano address to authenticate",
              example: "addr1qxck...",
            },
            signature: {
              type: "string",
              description: "Cryptographic signature of the nonce",
              example: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
            },
            key: {
              type: "string",
              description: "Public key used for signing",
              example: "a1b2c3d4e5f6789012345678901234567890abcdef",
            },
          },
          required: ["address", "signature", "key"],
        },
        AuthResponse: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "JWT bearer token for authenticated requests",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "Token expiration timestamp",
              example: "2024-01-15T16:30:00Z",
            },
            address: {
              type: "string",
              description: "Authenticated address",
              example: "addr1qxck...",
            },
          },
          required: ["token", "expiresAt", "address"],
        },
        NonceResponse: {
          type: "object",
          properties: {
            nonce: {
              type: "string",
              description: "Unique nonce to be signed for authentication",
              example: "multisig_auth_1234567890abcdef",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "Nonce expiration timestamp",
              example: "2024-01-15T10:35:00Z",
            },
            address: {
              type: "string",
              description: "Address the nonce was issued for",
              example: "addr1qxck...",
            },
          },
          required: ["nonce", "expiresAt", "address"],
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
    tags: [
      {
        name: "Authentication",
        description: "Endpoints for obtaining authentication tokens",
      },
      {
        name: "Wallets",
        description: "Wallet management and information",
      },
      {
        name: "Transactions",
        description: "Transaction creation, signing, and management",
      },
      {
        name: "UTXOs",
        description: "Unspent transaction output management",
      },
      {
        name: "Scripts",
        description: "Native script generation and management",
      },
    ],
    paths: {
      "/api/v1/getNonce": {
        get: {
          tags: ["Authentication"],
          summary: "Request nonce for address-based authentication",
          description: "Request a unique nonce that must be cryptographically signed to obtain an authentication token. The nonce is valid for 5 minutes and can only be used once.",
          operationId: "getNonce",
          parameters: [
            {
              name: "address",
              in: "query",
              required: true,
              description: "The Cardano address to authenticate",
              schema: {
                type: "string",
                pattern: "^addr[0-9a-z]+$",
                example: "addr1qxck...",
              },
            },
          ],
          responses: {
            200: {
              description: "Nonce successfully generated",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/NonceResponse",
                  },
                  example: {
                    nonce: "multisig_auth_1234567890abcdef",
                    expiresAt: "2024-01-15T10:35:00Z",
                    address: "addr1qxck...",
                  },
                },
              },
            },
            400: {
              description: "Invalid address format",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                  example: {
                    error: "Invalid address format",
                    code: "INVALID_ADDRESS",
                  },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                  example: {
                    error: "Rate limit exceeded. Please try again later.",
                    code: "RATE_LIMIT_EXCEEDED",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/authSigner": {
        post: {
          tags: ["Authentication"],
          summary: "Verify signed nonce and return bearer token",
          description: "Verify a cryptographically signed nonce and return a JWT bearer token for authenticated API access. The token is valid for 24 hours.",
          operationId: "authSigner",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthRequest",
                },
                example: {
                  address: "addr1qxck...",
                  signature: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
                  key: "a1b2c3d4e5f6789012345678901234567890abcdef",
                },
              },
            },
          },
          responses: {
            200: {
              description: "Authentication successful",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthResponse",
                  },
                  example: {
                    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    expiresAt: "2024-01-16T10:30:00Z",
                    address: "addr1qxck...",
                  },
                },
              },
            },
            400: {
              description: "Invalid request parameters",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                  example: {
                    error: "Missing required fields: address, signature, key",
                    code: "MISSING_FIELDS",
                  },
                },
              },
            },
            401: {
              description: "Invalid signature or expired nonce",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                  example: {
                    error: "Invalid signature or nonce expired",
                    code: "AUTHENTICATION_FAILED",
                  },
                },
              },
            },
            429: {
              description: "Rate limit exceeded",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                  example: {
                    error: "Rate limit exceeded. Please try again later.",
                    code: "RATE_LIMIT_EXCEEDED",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/walletIds": {
        get: {
          tags: ["Wallets"],
          summary: "Get all wallet IDs and names associated with an address",
          description: "Retrieve a list of all multisig wallets that the specified address is authorized to access. This includes wallet IDs, names, and basic metadata.",
          operationId: "getWalletIds",
          security: [
            {
              BearerAuth: [],
            },
          ],
          parameters: [
            {
              name: "address",
              in: "query",
              required: true,
              description: "The address to look up wallets for",
              schema: {
                type: "string",
                pattern: "^addr[0-9a-z]+$",
                example: "addr1qxck...",
              },
            },
          ],
          responses: {
            200: {
              description: "List of wallet information",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        walletId: {
                          type: "string",
                          description: "Unique wallet identifier",
                          example: "wallet_1234567890abcdef",
                        },
                        walletName: {
                          type: "string",
                          description: "Human-readable wallet name",
                          example: "Team Treasury Wallet",
                        },
                        description: {
                          type: "string",
                          description: "Optional wallet description",
                          example: "Main treasury wallet for team operations",
                        },
                        requiredSignatures: {
                          type: "integer",
                          description: "Number of signatures required",
                          example: 3,
                        },
                        totalSigners: {
                          type: "integer",
                          description: "Total number of authorized signers",
                          example: 5,
                        },
                      },
                      required: ["walletId", "walletName", "requiredSignatures", "totalSigners"],
                    },
                  },
                  example: [
                    {
                      walletId: "wallet_1234567890abcdef",
                      walletName: "Team Treasury Wallet",
                      description: "Main treasury wallet for team operations",
                      requiredSignatures: 3,
                      totalSigners: 5,
                    },
                  ],
                },
              },
            },
            400: {
              description: "Invalid address parameter",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            401: {
              description: "Unauthorized - invalid or missing token",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "No wallets found for the specified address",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/lookupMultisigWallet": {
        get: {
          tags: ["Wallets"],
          summary: "Lookup multisig wallet metadata using pubKeyHashes",
          description: "Look up multisig wallet metadata by providing one or more public key hashes. This is useful for discovering wallet information without knowing the wallet ID.",
          operationId: "lookupMultisigWallet",
          parameters: [
            {
              name: "pubKeyHashes",
              in: "query",
              required: true,
              description: "Single Key Hash or comma-separated list of public key hashes",
              schema: {
                type: "string",
                example: "a1b2c3d4e5f6789012345678901234567890abcdef",
              },
            },
            {
              name: "network",
              in: "query",
              required: false,
              description: "Cardano network (0: testnet, 1: mainnet)",
              schema: {
                type: "integer",
                enum: [0, 1],
                default: 1,
                example: 1,
              },
            },
          ],
          responses: {
            200: {
              description: "List of matching wallet metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        walletId: {
                          type: "string",
                          description: "Unique wallet identifier",
                          example: "wallet_1234567890abcdef",
                        },
                        walletName: {
                          type: "string",
                          description: "Human-readable wallet name",
                          example: "Team Treasury Wallet",
                        },
                        pubKeyHashes: {
                          type: "array",
                          items: {
                            type: "string",
                          },
                          description: "List of public key hashes for this wallet",
                          example: ["a1b2c3d4e5f6789012345678901234567890abcdef"],
                        },
                        requiredSignatures: {
                          type: "integer",
                          description: "Number of signatures required",
                          example: 3,
                        },
                        network: {
                          type: "integer",
                          description: "Cardano network identifier",
                          example: 1,
                        },
                      },
                    },
                  },
                  example: [
                    {
                      walletId: "wallet_1234567890abcdef",
                      walletName: "Team Treasury Wallet",
                      pubKeyHashes: ["a1b2c3d4e5f6789012345678901234567890abcdef"],
                      requiredSignatures: 3,
                      network: 1,
                    },
                  ],
                },
              },
            },
            400: {
              description: "Missing or invalid pubKeyHashes parameter",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "No wallets found for the specified public key hashes",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/freeUtxos": {
        get: {
          tags: ["UTXOs"],
          summary: "Get unblocked UTxOs for a wallet",
          description: "Retrieve all unspent transaction outputs (UTXOs) that are available for spending in the specified wallet. This includes ADA and any native tokens.",
          operationId: "getFreeUtxos",
          security: [
            {
              BearerAuth: [],
            },
          ],
          parameters: [
            {
              name: "walletId",
              in: "query",
              required: true,
              description: "ID of the multisig wallet",
              schema: {
                type: "string",
                example: "wallet_1234567890abcdef",
              },
            },
            {
              name: "address",
              in: "query",
              required: true,
              description: "Address associated with the wallet",
              schema: {
                type: "string",
                pattern: "^addr[0-9a-z]+$",
                example: "addr1qxck...",
              },
            },
          ],
          responses: {
            200: {
              description: "List of available UTXOs",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/UTXO",
                    },
                  },
                  example: [
                    {
                      txHash: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
                      outputIndex: 0,
                      address: "addr1qxck...",
                      amount: {
                        lovelace: "10000000",
                        ada: 10.0,
                      },
                      assets: [
                        {
                          policyId: "a1b2c3d4e5f6789012345678901234567890abcdef",
                          assetName: "546f6b656e",
                          quantity: "1000",
                        },
                      ],
                    },
                  ],
                },
              },
            },
            400: {
              description: "Invalid wallet ID or address",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            401: {
              description: "Unauthorized - invalid or missing token",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "Wallet not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/nativeScript": {
        get: {
          tags: ["Scripts"],
          summary: "Get native scripts for a multisig wallet",
          description: "Generate native scripts for the specified multisig wallet. These scripts can be used to create transactions that require multiple signatures.",
          operationId: "getNativeScript",
          security: [
            {
              BearerAuth: [],
            },
          ],
          parameters: [
            {
              name: "walletId",
              in: "query",
              required: true,
              description: "ID of the multisig wallet",
              schema: {
                type: "string",
                example: "wallet_1234567890abcdef",
              },
            },
            {
              name: "address",
              in: "query",
              required: true,
              description: "Address associated with the wallet",
              schema: {
                type: "string",
                pattern: "^addr[0-9a-z]+$",
                example: "addr1qxck...",
              },
            },
          ],
          responses: {
            200: {
              description: "Native scripts for the wallet",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/NativeScript",
                    },
                  },
                  example: [
                    {
                      type: "ScriptAll",
                      script: {
                        type: "ScriptAll",
                        scripts: [
                          {
                            type: "ScriptPubkey",
                            keyHash: "a1b2c3d4e5f6789012345678901234567890abcdef",
                          },
                        ],
                      },
                      cbor: "d8799f581c...",
                    },
                  ],
                },
              },
            },
            400: {
              description: "Invalid wallet ID or address",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            401: {
              description: "Unauthorized - invalid or missing token",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "Wallet not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/addTransaction": {
        post: {
          tags: ["Transactions"],
          summary: "Submit a new external transaction",
          description: "Submit a new transaction for a multisig wallet. The transaction will be marked as pending until the required number of signatures are collected.",
          operationId: "addTransaction",
          security: [
            {
              BearerAuth: [],
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: {
                      type: "string",
                      description: "ID of the multisig wallet",
                      example: "wallet_1234567890abcdef",
                    },
                    txCbor: {
                      type: "string",
                      description: "CBOR-encoded transaction",
                      example: "84a40081825820...",
                    },
                    txJson: {
                      type: "string",
                      description: "JSON representation of the transaction",
                      example: '{"type": "Tx", "description": "Payment transaction"}',
                    },
                    description: {
                      type: "string",
                      description: "Human-readable description of the transaction",
                      example: "Payment to vendor for services",
                    },
                    address: {
                      type: "string",
                      description: "Address submitting the transaction",
                      pattern: "^addr[0-9a-z]+$",
                      example: "addr1qxck...",
                    },
                  },
                  required: ["walletId", "txCbor", "txJson", "description", "address"],
                },
                example: {
                  walletId: "wallet_1234567890abcdef",
                  txCbor: "84a40081825820...",
                  txJson: '{"type": "Tx", "description": "Payment transaction"}',
                  description: "Payment to vendor for services",
                  address: "addr1qxck...",
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
                    $ref: "#/components/schemas/Transaction",
                  },
                },
              },
            },
            400: {
              description: "Missing required fields or invalid data",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            401: {
              description: "Unauthorized - invalid or missing token",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "Wallet not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            409: {
              description: "Transaction already exists",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/submitDatum": {
        post: {
          tags: ["Transactions"],
          summary: "Submit a new signable payload",
          description: "Submit a new signable payload (datum) for a multisig wallet. This is used for complex transactions that require datum signing.",
          operationId: "submitDatum",
          security: [
            {
              BearerAuth: [],
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletId: {
                      type: "string",
                      description: "ID of the multisig wallet",
                      example: "wallet_1234567890abcdef",
                    },
                    datum: {
                      type: "string",
                      description: "CBOR-encoded datum to be signed",
                      example: "d8799f581c...",
                    },
                    description: {
                      type: "string",
                      description: "Human-readable description of the datum",
                      example: "Stake delegation datum",
                    },
                    address: {
                      type: "string",
                      description: "Address submitting the datum",
                      pattern: "^addr[0-9a-z]+$",
                      example: "addr1qxck...",
                    },
                    callbackUrl: {
                      type: "string",
                      format: "uri",
                      description: "Optional callback URL for notifications",
                      example: "https://example.com/callback",
                    },
                    signature: {
                      type: "string",
                      description: "Cryptographic signature of the datum",
                      example: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
                    },
                    key: {
                      type: "string",
                      description: "Public key used for signing",
                      example: "a1b2c3d4e5f6789012345678901234567890abcdef",
                    },
                  },
                  required: ["walletId", "datum", "description", "address", "signature", "key"],
                },
                example: {
                  walletId: "wallet_1234567890abcdef",
                  datum: "d8799f581c...",
                  description: "Stake delegation datum",
                  address: "addr1qxck...",
                  callbackUrl: "https://example.com/callback",
                  signature: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
                  key: "a1b2c3d4e5f6789012345678901234567890abcdef",
                },
              },
            },
          },
          responses: {
            201: {
              description: "Datum successfully submitted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        description: "Unique datum identifier",
                        example: "datum_1234567890abcdef",
                      },
                      walletId: {
                        type: "string",
                        description: "Associated wallet ID",
                        example: "wallet_1234567890abcdef",
                      },
                      status: {
                        type: "string",
                        enum: ["pending", "signed", "completed", "failed"],
                        description: "Current status",
                        example: "pending",
                      },
                      signedAddresses: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                        description: "List of addresses that have signed",
                        example: ["addr1qxck..."],
                      },
                      requiredSignatures: {
                        type: "integer",
                        description: "Number of signatures required",
                        example: 3,
                      },
                      createdAt: {
                        type: "string",
                        format: "date-time",
                        example: "2024-01-15T10:30:00Z",
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "Missing required fields or invalid data",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            401: {
              description: "Unauthorized - invalid or missing token",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
            404: {
              description: "Wallet not found",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/Error",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [],
});
