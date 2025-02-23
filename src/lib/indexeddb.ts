import Dexie from "dexie";
import { get, set, del } from "idb-keyval";
import { StateStorage } from "zustand/middleware";

export const INDEXEDDB_DBNAME = "mesh-multisig";
export const INDEXEDDB_STORENAME_WALLETS = "multisig";

export const DURATION_LAST_SYNC = 1000 * 60 * 60;

export async function writeLocalData(
  storeName: string,
  data: { id: string; data: any }
) {
  const db = await getDb();
  db.table(storeName).put(data);
}

export async function readLocalData(storeName: string, id: string) {
  const db = await getDb();
  const data = await db.table(storeName).get(id);
  return data?.data;
}

async function getDb() {
  const db = new Dexie(INDEXEDDB_DBNAME);
  db.version(1).stores({
    [INDEXEDDB_STORENAME_WALLETS]: "id, data",
  });
  return db;
}

export const zustandStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};
