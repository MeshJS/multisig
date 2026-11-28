// November 2026 lint cleanup: behavior-sensitive React refactors are deferred.
// These compiler diagnostics remain visible as warnings ONLY in the existing
// preprod files below. New files retain the upstream error severity.
// Do not expand this list to accommodate new code. Remove a file after its
// effects, refs, mutation or memoization have been reviewed and regression-tested.
// rules-of-hooks and exhaustive-deps keep their normal severity everywhere.
export default [
  {
    "name": "preprod-deferred/react-hooks/immutability",
    "files": [
      "src/components/pages/homepage/wallets/invite/info/index.tsx",
      "src/components/pages/wallet/info/migration/NewWalletCreationStep.tsx",
      "src/components/pages/wallet/new-transaction/utxoSelector.tsx",
      "src/components/ui/globe.tsx"
    ],
    "rules": {
      "react-hooks/immutability": "warn"
    }
  },
  {
    "name": "preprod-deferred/react-hooks/preserve-manual-memoization",
    "files": [
      "src/components/multisig/proxy/ProxyControl.tsx",
      "src/components/pages/wallet/build/inspector/vote-rationale-editor.tsx",
      "src/components/pages/wallet/info/signers/card-edit-signers.tsx"
    ],
    "rules": {
      "react-hooks/preserve-manual-memoization": "warn"
    }
  },
  {
    "name": "preprod-deferred/react-hooks/purity",
    "files": [
      "src/components/pages/wallet/governance/clarity/create-clarity-action-page.tsx",
      "src/components/pages/wallet/tasks/payout-dialog.tsx",
      "src/components/pages/wallet/tasks/task-card.tsx",
      "src/hooks/useWalletDetection.ts"
    ],
    "rules": {
      "react-hooks/purity": "warn"
    }
  },
  {
    "name": "preprod-deferred/react-hooks/refs",
    "files": [
      "src/components/pages/wallet/build/index.tsx",
      "src/components/pages/wallet/transactions/transaction-card.tsx",
      "src/components/ui/globe.tsx",
      "src/hooks/useDraftCollateral.ts",
      "src/hooks/useDraftScriptInputs.ts",
      "src/hooks/usePendingEditor.ts"
    ],
    "rules": {
      "react-hooks/refs": "warn"
    }
  },
  {
    "name": "preprod-deferred/react-hooks/set-state-in-effect",
    "files": [
      "src/components/common/ImgDragAndDrop.tsx",
      "src/components/common/cardano-objects/connect-wallet.tsx",
      "src/components/common/overall-layout/layout.tsx",
      "src/components/common/overall-layout/mobile-wrappers/wallet-data-loader-wrapper.tsx",
      "src/components/common/token-flow/timeline-canvas.tsx",
      "src/components/multisig/inspect-multisig-script.tsx",
      "src/components/multisig/proxy/ProxyControl.tsx",
      "src/components/pages/homepage/globe.tsx",
      "src/components/pages/homepage/governance/drep/id/index.tsx",
      "src/components/pages/homepage/governance/drep/id/voteHistory.tsx",
      "src/components/pages/homepage/multisig-explainer.tsx",
      "src/components/pages/homepage/wallets/import-wallet-flow/source/index.tsx",
      "src/components/pages/homepage/wallets/invite/ManageSignerCard.tsx",
      "src/components/pages/homepage/wallets/invite/index.tsx",
      "src/components/pages/homepage/wallets/new-wallet-flow/create/ReviewNativeScript.tsx",
      "src/components/pages/homepage/wallets/new-wallet-flow/create/ReviewRequiredSignersCard.tsx",
      "src/components/pages/homepage/wallets/new-wallet-flow/create/ReviewWalletInfoCard.tsx",
      "src/components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState.tsx",
      "src/components/pages/homepage/wallets/new-wallet/index.tsx",
      "src/components/pages/vault/browser.tsx",
      "src/components/pages/wallet/build/add-stake-dialog.tsx",
      "src/components/pages/wallet/build/add-vote-dialog.tsx",
      "src/components/pages/wallet/build/index.tsx",
      "src/components/pages/wallet/build/inspector/collateral-editor.tsx",
      "src/components/pages/wallet/build/inspector/output-inspector.tsx",
      "src/components/pages/wallet/build/inspector/script-inputs-editor.tsx",
      "src/components/pages/wallet/build/inspector/vote-rationale-editor.tsx",
      "src/components/pages/wallet/build/problems-panel.tsx",
      "src/components/pages/wallet/documents/editor.tsx",
      "src/components/pages/wallet/documents/version-diff-dialog.tsx",
      "src/components/pages/wallet/governance/card-info.tsx",
      "src/components/pages/wallet/governance/overview-summary.tsx",
      "src/components/pages/wallet/governance/proposals.tsx",
      "src/components/pages/wallet/governance/rationale/RationaleEditor.tsx",
      "src/components/pages/wallet/info/card-info.tsx",
      "src/components/pages/wallet/info/migrate-wallet.tsx",
      "src/components/pages/wallet/info/migration/FundTransferStep.tsx",
      "src/components/pages/wallet/info/migration/MigrationCompleteStep.tsx",
      "src/components/pages/wallet/info/migration/MigrationPreChecks.tsx",
      "src/components/pages/wallet/info/migration/ProxySetupStep.tsx",
      "src/components/pages/wallet/info/migration/useMigrationWalletFlowState.tsx",
      "src/components/pages/wallet/info/signers/card-show-signers.tsx",
      "src/components/pages/wallet/info/upgrade-staking-wallet.tsx",
      "src/components/pages/wallet/info/wallet-notification-settings.tsx",
      "src/components/pages/wallet/new-transaction/utxoSelector.tsx",
      "src/components/pages/wallet/staking/poolSelector.tsx",
      "src/components/pages/wallet/tasks/board.tsx",
      "src/components/pages/wallet/tasks/index.tsx",
      "src/components/pages/wallet/tasks/payout-dialog.tsx",
      "src/components/pages/wallet/tasks/task-dialog.tsx",
      "src/components/pages/wallet/transactions/all-transactions.tsx",
      "src/components/pages/wallet/transactions/card-balance.tsx",
      "src/components/pages/wallet/transactions/collateral-review.tsx",
      "src/components/pages/wallet/transactions/transaction-card.tsx",
      "src/components/ui/reveal.tsx",
      "src/components/ui/typewriter.tsx",
      "src/hooks/useMeshWallet.ts",
      "src/hooks/usePendingTransactionReview.ts",
      "src/hooks/useWalletBalances.ts",
      "src/hooks/useWalletDetection.ts",
      "src/pages/_app.tsx",
      "src/pages/globe.tsx"
    ],
    "rules": {
      "react-hooks/set-state-in-effect": "warn"
    }
  }
];
