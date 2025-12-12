import CardUI from "@/components/ui/card-content";
import { getProvider } from "@/utils/get-provider";
import RowLabelInfo from "@/components/common/row-label-info";
import { useSiteStore } from "@/lib/zustand/site";
import type { ProposalMetadata, ProposalDetails, ProposalParameters, ProposalWithdrawal } from "@/types/governance";
import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/common/button";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "../vote-card";
import type { UTxO } from "@meshsdk/core";
import UTxOSelector from "../../new-transaction/utxoSelector";
import BallotModal from "../ballot/BallotModal";
import { useBallotModal, BallotModalProvider } from "@/hooks/useBallotModal";
import { useBallot } from "@/hooks/useBallot";
import ReactMarkdown from 'react-markdown';
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Calendar, Coins, Hash, FileText, Wallet } from "lucide-react";

function WalletGovernanceProposalContent({ id }: { id: string }) {
  const network = useSiteStore((state) => state.network);
  const [proposalMetadata, setProposalMetadata] = useState<
    ProposalMetadata | undefined
  >(undefined);
  const [proposalDetails, setProposalDetails] = useState<
    ProposalDetails | undefined
  >(undefined);
  const [proposalParameters, setProposalParameters] = useState<
    ProposalParameters | undefined
  >(undefined);
  const [proposalWithdrawals, setProposalWithdrawals] = useState<
    ProposalWithdrawal[] | undefined
  >(undefined);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const { appWallet } = useAppWallet();
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [selectedBallotId, setSelectedBallotId] = useState<string | undefined>(
    undefined,
  );
  const { isOpen, closeModal, currentProposalId, currentProposalTitle } = useBallotModal();

  const { ballots } = useBallot(appWallet?.id);
  const selected = ballots?.find((b) => b.id === selectedBallotId);
  const proposalCount = selected?.items?.length ?? 0;
  const totalProposalCount =
    ballots?.reduce(
      (sum, b) => sum + (Array.isArray(b.items) ? b.items.length : 0),
      0,
    ) ?? 0;

  useEffect(() => {
    const blockchainProvider = getProvider(network);
    async function fetchProposalData() {
      const [txHash, certIndex] = id.split(":");
      setLoadingDetails(true);
      
      try {
        // Fetch metadata
        const metadata = await blockchainProvider.get(
          `/governance/proposals/${txHash}/${certIndex}/metadata`,
        ) as ProposalMetadata;
        setProposalMetadata(metadata);

        // Fetch proposal details
        try {
          const details = await blockchainProvider.get(
            `/governance/proposals/${txHash}/${certIndex}`,
          ) as ProposalDetails;
          setProposalDetails(details);

          // Fetch parameters if it's a parameter update proposal
          if (details.governance_type === "parameter_change" || details.governance_type === "info_action") {
            try {
              const params = await blockchainProvider.get(
                `/governance/proposals/${txHash}/${certIndex}/parameters`,
              ) as ProposalParameters;
              setProposalParameters(params);
            } catch (error: any) {
              if (error?.status !== 404) {
                console.error("Error fetching parameters:", error);
              }
            }
          }

          // Fetch withdrawals if it's a treasury withdrawal
          if (details.governance_type === "treasury_withdrawals") {
            try {
              const withdrawals = await blockchainProvider.get(
                `/governance/proposals/${txHash}/${certIndex}/withdrawals`,
              ) as ProposalWithdrawal[];
              setProposalWithdrawals(withdrawals);
            } catch (error: any) {
              if (error?.status !== 404) {
                console.error("Error fetching withdrawals:", error);
              }
            }
          }
        } catch (error: any) {
          if (error?.status !== 404) {
            console.error("Error fetching proposal details:", error);
          }
        }
      } catch (error) {
        console.error("Error fetching proposal metadata:", error);
      } finally {
        setLoadingDetails(false);
      }
    }
    void fetchProposalData();
  }, [id, network]);

  // Helper function to get proposal status
  const getProposalStatus = () => {
    if (!proposalDetails) return null;
    if (proposalDetails.enacted_epoch) return { label: "Enacted", icon: CheckCircle2, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" };
    if (proposalDetails.dropped_epoch) return { label: "Dropped", icon: XCircle, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" };
    if (proposalDetails.expired_epoch) return { label: "Expired", icon: XCircle, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" };
    if (proposalDetails.ratified_epoch) return { label: "Ratified", icon: CheckCircle2, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" };
    return { label: "Active", icon: Clock, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" };
  };

  const status = getProposalStatus();

  if (!proposalMetadata || loadingDetails) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-center py-12 sm:py-16">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-400 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400">Loading proposal...</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8 max-w-7xl mx-auto w-full">
      {/* Proposal Status & Details Card */}
      {proposalDetails && (
        <CardUI
          title="Proposal Details"
          cardClassName="w-full"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Status */}
            {status && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Status</span>
                </div>
                <Badge className={`${status.color} flex items-center gap-1.5 w-fit`}>
                  <status.icon className="h-3 w-3" />
                  {status.label}
                </Badge>
              </div>
            )}

            {/* Governance Type */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-500" />
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Type</span>
              </div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 capitalize">
                {proposalDetails.governance_type.replace(/_/g, " ")}
              </div>
            </div>

            {/* Deposit */}
            {proposalDetails.deposit && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-gray-500" />
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Deposit</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  {(parseInt(proposalDetails.deposit) / 1_000_000).toFixed(2)} ADA
                </div>
              </div>
            )}

            {/* Ratified Epoch */}
            {proposalDetails.ratified_epoch && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Ratified Epoch</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  {proposalDetails.ratified_epoch}
                </div>
              </div>
            )}

            {/* Enacted Epoch */}
            {proposalDetails.enacted_epoch && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-gray-500" />
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Enacted Epoch</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  {proposalDetails.enacted_epoch}
                </div>
              </div>
            )}

            {/* Expiration */}
            {proposalDetails.expiration && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Expires In</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  {proposalDetails.expiration} epochs
                </div>
              </div>
            )}

            {/* Transaction Hash */}
            <div className="space-y-2 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-gray-500" />
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Transaction</span>
              </div>
              <div className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                {proposalDetails.tx_hash}
              </div>
            </div>
          </div>
        </CardUI>
      )}

      {/* Main Proposal Content */}
      <CardUI
        title={proposalMetadata.json_metadata.body.title}
        cardClassName="w-full"
        headerDom={
          network == 1 && (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
              <Button className="w-full sm:w-auto text-xs sm:text-sm py-2">
                <Link
                  href={`https://gov.tools/governance_actions/${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
                  target="_blank"
                  className="w-full inline-block"
                >
                  GOV TOOL
                </Link>
              </Button>
              <Button className="w-full sm:w-auto text-xs sm:text-sm py-2">
                <Link
                  href={`https://adastat.net/governances/${proposalMetadata.tx_hash}0${proposalMetadata.cert_index}`}
                  target="_blank"
                  className="w-full inline-block"
                >
                  ADASTAT
                </Link>
              </Button>
            </div>
          )
        }
      >
        <div className="space-y-4 sm:space-y-6 w-full">
          {/* Authors */}
          <div className="space-y-2 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 w-full">
              <div className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0 min-w-20">
                Authors
              </div>
              <div className="flex-1 text-xs sm:text-sm text-muted-foreground break-words">
                {(proposalMetadata.json_metadata.authors as { name: string }[])
                  .map((author) => author.name)
                  .join(", ") || "N/A"}
              </div>
            </div>
          </div>

          {/* Abstract */}
          <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6 w-full">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 w-full">
              <div className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0 min-w-20">
                Abstract
              </div>
              <div className="flex-1 min-w-0 w-full prose prose-sm sm:prose-base max-w-none prose-headings:text-sm sm:prose-headings:text-base prose-p:text-xs sm:prose-p:text-sm prose-p:my-2 sm:prose-p:my-3 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline prose-ul:text-xs sm:prose-ul:text-sm prose-ol:text-xs sm:prose-ol:text-sm prose-li:text-xs sm:prose-li:text-sm prose-code:text-xs sm:prose-code:text-sm prose-pre:text-xs sm:prose-pre:text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {proposalMetadata.json_metadata.body.abstract || "No abstract provided."}
                </ReactMarkdown>
              </div>
            </div>
          </div>

          {/* Motivation */}
          {proposalMetadata.json_metadata.body.motivation && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6 w-full">
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 w-full">
                <div className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0 min-w-20">
                  Motivation
                </div>
                <div className="flex-1 min-w-0 w-full prose prose-sm sm:prose-base max-w-none prose-headings:text-sm sm:prose-headings:text-base prose-p:text-xs sm:prose-p:text-sm prose-p:my-2 sm:prose-p:my-3 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline prose-ul:text-xs sm:prose-ul:text-sm prose-ol:text-xs sm:prose-ol:text-sm prose-li:text-xs sm:prose-li:text-sm prose-code:text-xs sm:prose-code:text-sm prose-pre:text-xs sm:prose-pre:text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {proposalMetadata.json_metadata.body.motivation}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Rationale */}
          {proposalMetadata.json_metadata.body.rationale && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6 w-full">
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 w-full">
                <div className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0 min-w-20">
                  Rationale
                </div>
                <div className="flex-1 min-w-0 w-full prose prose-sm sm:prose-base max-w-none prose-headings:text-sm sm:prose-headings:text-base prose-p:text-xs sm:prose-p:text-sm prose-p:my-2 sm:prose-p:my-3 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline prose-ul:text-xs sm:prose-ul:text-sm prose-ol:text-xs sm:prose-ol:text-sm prose-li:text-xs sm:prose-li:text-sm prose-code:text-xs sm:prose-code:text-sm prose-pre:text-xs sm:prose-pre:text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {proposalMetadata.json_metadata.body.rationale}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* References */}
          {proposalMetadata.json_metadata.body.references && proposalMetadata.json_metadata.body.references.length > 0 && (
            <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6 w-full">
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 w-full">
                <div className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0 min-w-20">
                  References
                </div>
                <div className="flex-1 min-w-0 w-full">
                  <ul className="space-y-2 text-xs sm:text-sm">
                    {proposalMetadata.json_metadata.body.references.map((ref, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-gray-500">•</span>
                        {ref.uri ? (
                          <a href={ref.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline break-all">
                            {ref.label || ref.uri}
                          </a>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">{ref.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardUI>

      {/* Parameters Card - Show for parameter change proposals */}
      {proposalParameters && proposalParameters.parameters && (
        <CardUI
          title="Protocol Parameters"
          cardClassName="w-full"
        >
          <div className="space-y-4">
            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-4">
              Proposed changes to protocol parameters
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {Object.entries(proposalParameters.parameters)
                .filter(([key, value]) => value !== null && value !== undefined && key !== 'id' && key !== 'tx_hash' && key !== 'cert_index')
                .slice(0, 12)
                .map(([key, value]) => (
                  <div key={key} className="space-y-1 p-2 sm:p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {key.replace(/_/g, " ")}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 break-words">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </div>
                  </div>
                ))}
            </div>
            {Object.keys(proposalParameters.parameters).length > 12 && (
              <div className="text-xs text-gray-500 dark:text-gray-400 pt-2">
                + {Object.keys(proposalParameters.parameters).length - 12} more parameters
              </div>
            )}
          </div>
        </CardUI>
      )}

      {/* Withdrawals Card - Show for treasury withdrawal proposals */}
      {proposalWithdrawals && proposalWithdrawals.length > 0 && (
        <CardUI
          title="Treasury Withdrawals"
          cardClassName="w-full"
        >
          <div className="space-y-3">
            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">
              {proposalWithdrawals.length} withdrawal{proposalWithdrawals.length !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2">
              {proposalWithdrawals.map((withdrawal, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Wallet className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                      {withdrawal.stake_address}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">
                    {(parseInt(withdrawal.amount) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ADA
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Total Amount:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {proposalWithdrawals.reduce((sum, w) => sum + parseInt(w.amount), 0) / 1_000_000} ADA
                </span>
              </div>
            </div>
          </div>
        </CardUI>
      )}
      {appWallet && (
        <UTxOSelector
          appWallet={appWallet}
          network={network}
            onSelectionChange={(utxos) => {
              setManualUtxos(utxos);
            }}
        />
      )}
      {appWallet && (
        <VoteCard
          appWallet={appWallet}
          utxos={manualUtxos}
          proposalId={`${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
          selectedBallotId={selectedBallotId}
          proposalTitle={proposalMetadata.json_metadata.body.title}
        />
      )}
      {appWallet && (
        <BallotModal
          appWallet={appWallet}
          selectedBallotId={selectedBallotId}
          onSelectBallot={setSelectedBallotId}
          utxos={manualUtxos}
          open={isOpen}
          onOpenChange={closeModal}
          currentProposalId={currentProposalId || `${proposalMetadata.tx_hash}#${proposalMetadata.cert_index}`}
          currentProposalTitle={currentProposalTitle || proposalMetadata.json_metadata.body.title}
          onBallotChanged={() => {
            // Refresh any necessary data
          }}
        />
      )}
    </main>
  );
}

export default function WalletGovernanceProposal({ id }: { id: string }) {
  return (
    <BallotModalProvider>
      <WalletGovernanceProposalContent id={id} />
    </BallotModalProvider>
  );
}
