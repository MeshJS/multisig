import Link from "next/link";
export default function GettingStarted() {
  return (
    <article className="mx-auto w-full max-w-3xl space-y-8 py-6">
      <header>
        <h1 className="text-3xl font-bold">Getting Started</h1>
        <p className="mt-3 text-muted-foreground">
          Set up a shared Cardano wallet with your team. Read this guide before
          connecting a wallet and return to it from Learn &amp; Help at any
          time.
        </p>
      </header>
      <section id="create-import" className="space-y-3">
        <h2 className="text-xl font-semibold">1. Create or import a wallet</h2>
        <p>
          Connect your Cardano wallet to sign in. Create a multisig wallet,
          choose its signers and approval threshold, and review the
          configuration together. If your team already has a wallet, use the
          import flow instead.
        </p>
        <div className="flex flex-wrap gap-4 underline underline-offset-4">
          <Link prefetch={false} href="/wallets/new-wallet-flow/save">
            Create a wallet
          </Link>
          <Link prefetch={false} href="/wallets/import-wallet">
            Import a wallet
          </Link>
          <Link prefetch={false} href="/wallets">
            My wallets
          </Link>
        </div>
      </section>
      <section id="invite-signers" className="space-y-3">
        <h2 className="text-xl font-semibold">2. Invite your signers</h2>
        <p>
          Share the invitation link from the creation flow with your co-signers.
          Each signer connects their own wallet and checks their details. Review
          the signer list and required approvals before completing setup. Never
          share recovery phrases or private keys.
        </p>
      </section>
      <section id="first-transaction" className="space-y-3">
        <h2 className="text-xl font-semibold">
          3. Review your first transaction
        </h2>
        <p>
          Open your wallet and go to Transactions. When a proposed transaction
          is ready, check the recipients, amounts, fees, and other actions
          before signing. Your co-signers review it independently, and the
          required signatures must be collected before submission. Reading this
          guide does not require sending funds.
        </p>
      </section>
      <section id="automation" className="space-y-3">
        <h2 className="text-xl font-semibold">Optional: connect automation</h2>
        <p>
          Connect an AI client or configure a bot with only the access it needs.
          MCP clients can prepare unsigned drafts with permission, but cannot
          sign or broadcast transactions.
        </p>
        <div className="flex flex-wrap gap-4 underline underline-offset-4">
          <Link href="/docs/mcp">MCP setup</Link>
          <Link href="/bot-setup">Bot Setup</Link>
        </div>
      </section>
      <section id="documents" className="space-y-3">
        <h2 className="text-xl font-semibold">Optional: review documents</h2>
        <p>
          Open Documents in a selected wallet to create a document and request
          sign-off. Review the document version and signer requirements before
          approving. Use the public verifier to check a shared sign-off proof
          without connecting a wallet.
        </p>
        <Link href="/verify" className="underline underline-offset-4">
          Document verification
        </Link>
      </section>
    </article>
  );
}
