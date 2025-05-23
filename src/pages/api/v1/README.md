# API Endpoints for /api/v1

## `GET /api/v1/wIdsByAddr`

**Description**: Retrieve all wallet IDs associated with a given address.

**Query Parameters**:

- `address` (string, required): The user's address.

**Response**:

- `200 OK`: Returns a list of wallet IDs and names.
- `400 Bad Request`: If the address is not a string.
- `404 Not Found`: If no wallets are found.
- `500 Internal Server Error`: On unexpected failure.

## `GET /api/v1/pendingUTxOsByWId`

**Description**: Get all UTxOs for a multisig wallet that are not blocked by pending transactions.

**Query Parameters**:

- `walletId` (string, required): The wallet ID.
- `address` (string, required): The associated address.

**Response**:

- `200 OK`: Returns a list of available UTxOs as a Mesh SDK `UTxO[]` array.
- `400 Bad Request`: If walletId or address is invalid.
- `404 Not Found`: If the wallet cannot be found.
- `500 Internal Server Error`: On construction or fetching failure.
