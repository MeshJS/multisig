import { Key } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  return (
    <CardUI
      title="Signers"
      description={
        <>
          This wallet requires{" "}
          <b className="text-white">{appWallet.numRequiredSigners}</b> signers
          to sign a transaction.
        </>
      }
      icon={Key}
      cardClassName="col-span-2"
    >
      {appWallet.signersAddresses.map((signer, index) => (
        <RowLabelInfo
          label={
            appWallet.signersDescriptions[index] &&
            appWallet.signersDescriptions[index].length > 0
              ? appWallet.signersDescriptions[index]
              : `Signer ${index + 1}`
          }
          value={getFirstAndLast(signer)}
          copyString={signer}
          key={signer}
        />
      ))}
    </CardUI>
  );
}
