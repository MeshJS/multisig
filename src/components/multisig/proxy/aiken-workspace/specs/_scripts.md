# Aiken Crowdfunding

## 1. Auth Tokens

The tokens are held in a native script multisig wallet and have to be included in every transaction.


## 2. Proxy

The validator that represents the actual treasury / drep 

## Param dependency tree

1. First layer

   - `auth_tokens` - `utxo_ref`

2. Second layer

   - `proxy` - param `auth_tokens`
