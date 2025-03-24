import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { derivationPathToString, getPubKeyHash, KeyObject } from "./146sdk";

interface MultiSigSelectorProps {
  wallet: { keyObjects: KeyObject[] };
  onSelectChildKeys: (keys: KeyObject[]) => void;
}

const ChildKeyGroupSelector: React.FC<{
  groups: Record<number, KeyObject[]>;
  onSelectChildKeys: (keys: KeyObject[]) => void;
}> = ({ groups, onSelectChildKeys }) => {
  const groupKeys = Object.keys(groups)
    .map(Number)
    .sort((a, b) => a - b);
  //const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);

  return (
    <div className="ml-4">
      {groupKeys.map((groupKey) => {
        const isSelected = selectedGroup === groupKey;
        return (
          <div
            key={groupKey}
            className={`mb-2 rounded border p-2 ${
              isSelected ? "border-2 border-blue-500" : ""
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">
                Multisig Index: {groupKey}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedGroup(groupKey);
                  onSelectChildKeys(groups[groupKey]!);
                }}
                disabled={groups[groupKey]!.some(childKey => childKey.used)}
                className="px-3 py-1 text-sm font-medium"
              >
                Select Group
              </Button>
            </div>
            <Table>
              <TableBody>
                {groups[groupKey]!.map((childKey, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {derivationPathToString(childKey.derivationPath)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          childKey.used ? "bg-red-500" : "bg-green-500"
                        }`}
                      />
                    </TableCell>
                    <TableCell className="break-all text-sm">
                      {childKey.publicKey
                        ? getPubKeyHash(childKey.publicKey)
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );}

const MultiSigSelector: React.FC<MultiSigSelectorProps> = ({
  wallet,
  onSelectChildKeys,
}) => {
  // Separate parent (account) keys and child keys.
  const accountKeys = wallet.keyObjects.filter(
    (ko) => ko.derivationPath.role === undefined,
  );
  const childKeys = wallet.keyObjects.filter(
    (ko) => ko.derivationPath.role !== undefined,
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-sm">Path</TableHead>
          <TableHead className="text-sm">Used</TableHead>
          <TableHead className="text-sm">Public Key Hash</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accountKeys.map((accountKey) => {
          const { purpose, coinType, accountIndex } = accountKey.derivationPath;
          const parentPathStr = `m/${purpose}'/${coinType}'/${accountIndex}'`;
          // Find child keys whose parent's part matches.
          const children = childKeys.filter((child) => {
            const childParentStr = `m/${child.derivationPath.purpose}'/${child.derivationPath.coinType}'/${child.derivationPath.accountIndex}'`;
            return childParentStr === parentPathStr;
          });
          // Group child keys by their level 4 index.
          const grouped = children.reduce(
            (acc: Record<number, KeyObject[]>, child) => {
              const keyIndex = child.derivationPath.index;
              if (keyIndex === undefined) return acc;
              if (!acc[keyIndex]) {
                acc[keyIndex] = [];
              }
              acc[keyIndex].push(child);
              return acc;
            },
            {},
          );

          return (
            <React.Fragment key={parentPathStr}>
              {/* Parent Account Key Row */}
              <TableRow>
                <TableCell className="whitespace-nowrap text-sm font-bold">
                  {derivationPathToString(accountKey.derivationPath)}
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      accountKey.used ? "bg-red-500" : "bg-green-500"
                    }`}
                  />
                </TableCell>
                <TableCell className="break-all text-sm font-bold">
                  {accountKey.publicKey
                    ? getPubKeyHash(accountKey.publicKey)
                    : "N/A"}
                </TableCell>
              </TableRow>
              {/* If there are child keys, render a nested row with the ChildKeyGroupSelector */}
              {children.length > 0 && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <ChildKeyGroupSelector
                      groups={grouped}
                      onSelectChildKeys={(childKeys) => {
                        // Emit an array containing the parent account key and the selected child keys
                        onSelectChildKeys([accountKey, ...childKeys]);
                      }}
                    />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default MultiSigSelector;
