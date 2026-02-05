import fs from "fs";
import path from "path";
import { generateMnemonic } from "@meshsdk/core";

const MNEMONIC_PATH = path.resolve(
  process.cwd(),
  ".local",
  "test-agent-mnemonics.json",
);

const ensureDir = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const normalizeMnemonic = (mnemonic: string) =>
  mnemonic
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

const validateMnemonic = (mnemonic: string) => {
  const words = normalizeMnemonic(mnemonic);
  if (words.length !== 24) {
    throw new Error(
      `Invalid mnemonic length (${words.length}). Expected 24 words.`,
    );
  }
  return words.join(" ");
};

type MnemonicStore = {
  faucetMnemonic: string;
  agentMnemonic: string;
};

export const loadOrCreateMnemonics = (): MnemonicStore => {
  const dirPath = path.dirname(MNEMONIC_PATH);
  ensureDir(dirPath);

  if (fs.existsSync(MNEMONIC_PATH)) {
    const raw = fs.readFileSync(MNEMONIC_PATH, "utf-8");
    const data = JSON.parse(raw) as Partial<MnemonicStore>;
    if (!data.faucetMnemonic || !data.agentMnemonic) {
      throw new Error("Mnemonic file is missing required keys");
    }
    return {
      faucetMnemonic: validateMnemonic(data.faucetMnemonic),
      agentMnemonic: validateMnemonic(data.agentMnemonic),
    };
  }

  // Mesh's generateMnemonic expects strength in bits (128-256), not word count.
  const faucetMnemonic = generateMnemonic(256).toString();
  const agentMnemonic = generateMnemonic(256).toString();

  const stored: MnemonicStore = {
    faucetMnemonic: validateMnemonic(faucetMnemonic),
    agentMnemonic: validateMnemonic(agentMnemonic),
  };

  fs.writeFileSync(MNEMONIC_PATH, JSON.stringify(stored, null, 2));
  return stored;
};

export const getMnemonicPath = () => MNEMONIC_PATH;
