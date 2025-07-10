import React, { useState, useEffect } from "react";
import { MultisigKey, MultisigWallet } from "@/utils/multisigSDK";

interface RequiredSignersProps {
  multisigWallet: MultisigWallet;
  role: number;
  onChange: (selectedSigners: MultisigKey[]) => void;
}

export default function RequiredSigners({
  multisigWallet,
  role,
  onChange,
}: RequiredSignersProps) {
  const stakingKeys = multisigWallet.getKeysByRole(role) ?? [];
  const [selectedKeys, setSelectedKeys] = useState<MultisigKey[]>([]);

  useEffect(() => {
    onChange(selectedKeys);
  }, [selectedKeys, onChange]);

  function toggleKey(key: MultisigKey) {
    setSelectedKeys((prev) => {
      const exists = prev.find((k) => k.keyHash === key.keyHash);
      if (exists) {
        return prev.filter((k) => k.keyHash !== key.keyHash);
      } else {
        return [...prev, key];
      }
    });
  }

  return (
    <div>
      <h3>Required Signers (Staking Keys)</h3>
      {stakingKeys.length === 0 && (
        <p>No staking keys available in multisig wallet.</p>
      )}
      {stakingKeys.map((key) => (
        <div key={key.keyHash}>
          <label>
            <input
              type="checkbox"
              checked={selectedKeys.some(
                (k) => k.keyHash === key.keyHash,
              )}
              onChange={() => toggleKey(key)}
            />
            {key.name || key.keyHash}
          </label>
        </div>
      ))}
    </div>
  );
}