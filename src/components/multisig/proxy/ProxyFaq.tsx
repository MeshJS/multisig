import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import ProxyFlowAnimation from "./ProxyFlowAnimation";
import { HelpCircle } from "lucide-react";

interface FaqEntry {
  id: string;
  question: string;
  answer: React.ReactNode;
}

const ENTRIES: FaqEntry[] = [
  {
    id: "what",
    question: "What is a proxy?",
    answer: (
      <>
        <p>
          A proxy is a smart contract address that holds funds and carries its own
          DRep identity. Its address and DRep id are derived from a single wallet
          UTxO picked once at setup, so they can be recomputed from that reference
          alone — nothing about the identity is stored off-chain.
        </p>
        <ProxyFlowAnimation variant="setup" className="mt-3" />
      </>
    ),
  },
  {
    id: "why",
    question: "Why not just use the multisig wallet directly?",
    answer: (
      <p>
        A native-script multisig address is a function of its signer set, so adding
        or removing a signer produces a different address and a different DRep
        credential — you would lose your delegators. The proxy hangs off a one-time
        UTxO instead, so the signer set can change freely while the proxy address,
        its balance and its DRep id stay exactly as they were.
      </p>
    ),
  },
  {
    id: "tokens",
    question: "What are the 10 auth tokens?",
    answer: (
      <p>
        They are the key to the proxy. The minting policy is parameterised by the
        setup UTxO and only accepts a mint of exactly 10 while that UTxO is being
        consumed — since a UTxO can be spent once, exactly ten tokens can ever
        exist. They live at the multisig wallet as ten separate UTxOs, which lets
        several proxy actions be prepared at the same time without competing for
        one UTxO.
      </p>
    ),
  },
  {
    id: "authorize",
    question: "How does a proxy transaction get authorised?",
    answer: (
      <>
        <p>
          The on-chain rule is one line: the proxy unlocks for any transaction that
          puts at least one auth token in its outputs. To do that you first have to
          spend one, and the tokens sit at the multisig address — so satisfying the
          multisig is what really gates the proxy. Every action sends the token
          straight back to the wallet.
        </p>
        <ProxyFlowAnimation variant="action" className="mt-3" />
      </>
    ),
  },
  {
    id: "custody",
    question: "Who can spend from a proxy?",
    answer: (
      <p>
        Anyone holding an auth token. The script checks that a token is present, not
        where it came from, so custody of those ten tokens is control of the proxy.
        Keep them at the multisig address — if one ever leaves, whoever holds it can
        spend the proxy and vote as its DRep.
      </p>
    ),
  },
  {
    id: "access",
    question: "Does adding someone under “People with access” let them spend?",
    answer: (
      <p>
        No. That list is in-app only: it controls who can see and manage the proxy
        in this interface. Spending and voting still require an auth token, which
        means the multisig signers. Adding someone never grants on-chain authority,
        and removing them never takes any away.
      </p>
    ),
  },
  {
    id: "governance",
    question: "How does the proxy vote?",
    answer: (
      <p>
        The proxy script itself is the DRep credential, so it witnesses the
        registration certificate and every vote. Those transactions spend no proxy
        funds at all — only wallet UTxOs, plus the same auth token round trip.
        Registering a DRep needs 505 ADA selected to cover the 500 ADA deposit.
      </p>
    ),
  },
  {
    id: "close",
    question: "How do I close a proxy?",
    answer: (
      <>
        <p>
          In two transactions. While the proxy address still holds funds, a sweep
          returns them to the wallet. Once it is empty, a burn destroys all ten auth
          tokens at once — the policy refuses any partial burn, so a proxy is either
          fully live or fully retired.
        </p>
        <ProxyFlowAnimation variant="cleanup" className="mt-3" />
      </>
    ),
  },
];

export default function ProxyFaq({ className = "" }: { className?: string }) {
  return (
    <div className={`glass-card p-4 sm:p-5 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">How proxies work</h4>
      </div>
      <Accordion type="single" collapsible className="w-full">
        {ENTRIES.map((entry) => (
          <AccordionItem
            key={entry.id}
            value={entry.id}
            className="border-border/40 last:border-b-0"
          >
            <AccordionTrigger className="text-left hover:no-underline hover:text-primary">
              {entry.question}
            </AccordionTrigger>
            <AccordionContent className="space-y-1 text-sm leading-relaxed text-muted-foreground">
              {entry.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
