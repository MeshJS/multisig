import { fixupConfigRules } from "@eslint/compat";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptParser from "@typescript-eslint/parser";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  ...fixupConfigRules(
    compat.extends(
      "next/core-web-vitals",
      "plugin:@typescript-eslint/recommended-type-checked",
      "plugin:@typescript-eslint/stylistic-type-checked"
    )
  ),
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: true,
      },
    },
    rules: {
      // Guardrail: never pull `wallet` out of @meshsdk/react 2.0's useWallet().
      // That object is a low-level CIP-30 wallet whose signData(address, payload)
      // / signTx(tx, partialSign) signatures differ from the @meshsdk/core 1.9
      // IWallet the app is built on — a wrong-order call compiles but signs the
      // wrong bytes (caused VESPR CIP-30 InternalError -2 and ballot witness
      // divergence). Use useMeshWallet()/useActiveWallet() for any wallet ops;
      // useWallet() is fine for connection state only (name/connected/connect/
      // disconnect).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "VariableDeclarator[init.callee.name='useWallet'] > ObjectPattern > Property[key.name='wallet']",
          message:
            "Don't destructure `wallet` from @meshsdk/react useWallet() — its signData/signTx args differ from core 1.9 and silently sign wrong bytes. Use useMeshWallet()/useActiveWallet() instead.",
        },
      ],
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/prefer-for-of": "warn",
      "@typescript-eslint/non-nullable-type-assertion-style": "warn",
      "react/no-unescaped-entities": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-inferrable-types": "warn",
      "@typescript-eslint/consistent-indexed-object-style": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "no-var": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/prefer-includes": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
    },
  },
];

