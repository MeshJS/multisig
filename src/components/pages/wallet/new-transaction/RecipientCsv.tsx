import { ChangeEvent, useRef } from "react";
import Papa from "papaparse";
import { useDropzone } from "react-dropzone";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { toast } from "@/hooks/use-toast";

type RecipientCsvProps = {
  setRecipientAddresses: (value: string[]) => void;
  setAmounts: (value: string[]) => void;
  setAssets: (value: string[]) => void;
  recipientAddresses: string[];
  amounts: string[];
  assets: string[];
};

export default function RecipientCsv({
  setRecipientAddresses,
  setAmounts,
  setAssets,
  recipientAddresses,
  amounts,
  assets,
}: RecipientCsvProps) {
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    Papa.parse<string[]>(file, {
      complete: (results: Papa.ParseResult<string[]>) => {
        const rows = results.data as string[][];
        const newAddresses: string[] = [];
        const newAmounts: string[] = [];
        const newAssets: string[] = [];

        rows.forEach((row, index) => {
          if (index === 0) return; // skip header row
          const [address, unit, amount] = row;
          if (address && amount) {
            const resolvedUnit = (!unit || unit === "ADA") ? "ADA" : unit;
            const walletUnitList = walletAssets.map(a => a.unit).concat("ADA");

            if (!walletUnitList.includes(resolvedUnit)) {
              toast({
                title: "Unknown Asset",
                description: `Unit "${resolvedUnit}" not found in your wallet.`,
                variant: "destructive",
              });
              return;
            }

            newAddresses.push(address);
            newAmounts.push(amount);
            newAssets.push(resolvedUnit);
          }
        });

        setRecipientAddresses([...recipientAddresses, ...newAddresses]);
        setAmounts([...amounts, ...newAmounts]);
        setAssets([...assets, ...newAssets]);
      },
      skipEmptyLines: true,
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { "text/csv": [".csv"] } });

  return (
    <>
      <div
        {...getRootProps()}
        className="flex items-center justify-center border-2 border-dashed border-gray-400 p-4 rounded-md cursor-pointer hover:bg-gray-100"
      >
        <input {...getInputProps()} />
        {isDragActive ? (
          <p>Drop the CSV file here ...</p>
        ) : (
          <p>Drag & drop a CSV file here, or click to select one</p>
        )}
      </div>
      <div className="mt-2">
        <button
          className="text-blue-500 hover:underline text-sm"
          onClick={() => {
            const headers = "address,unit,amount\n";
            const rows = recipientAddresses.map((address, index) => {
              const unit = assets[index] === "ADA" ? "" : assets[index];
              const amount = amounts[index] || "";
              return `${address},${unit},${amount}`;
            });
            const csvContent = headers + rows.join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);

            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", "recipients.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
        >
          Download current recipients as CSV
        </button>
      </div>
    </>
  );
}