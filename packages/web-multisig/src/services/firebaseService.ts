import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  type Firestore,
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot
} from "firebase/firestore";
import type { RpcUtxo, ZcashNetwork } from "./zcashRpc";

const COLLECTION_NAME = import.meta.env.VITE_FIREBASE_TX_COLLECTION ?? "pendingTx";

export interface MultisigSignature {
  publicKey: string;
  signatures: string[];
  timestamp?: number;
}

export interface MultisigOwnerRecord {
  publicKey: string;
  label?: string;
}

export interface MultisigTxRecord {
  initialPsbt: string;
  signatures: MultisigSignature[];
  owners: MultisigOwnerRecord[];
  ownerPublicKeys: string[];
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number;
  network: ZcashNetwork;
  redeemScript: string;
  utxos: RpcUtxo[];
  createdAt?: number;
  executedTxId?: string;
  executedAt?: number;
}

let firebaseApp: FirebaseApp | undefined;
let firestoreDb: Firestore | undefined;

function assertFirebaseConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
} {
  const {
    VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_APP_ID,
    VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID
  } = import.meta.env;

  console.log("[Firebase config]", {
    projectId: VITE_FIREBASE_PROJECT_ID,
    appId: VITE_FIREBASE_APP_ID,
    authDomain: VITE_FIREBASE_AUTH_DOMAIN,
    storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
    apiKeyPresent: Boolean(VITE_FIREBASE_API_KEY)
  });

  if (!VITE_FIREBASE_API_KEY || !VITE_FIREBASE_AUTH_DOMAIN || !VITE_FIREBASE_PROJECT_ID || !VITE_FIREBASE_APP_ID) {
    throw new Error("Firebase: отсутствуют переменные окружения (apiKey/authDomain/projectId/appId)");
  }

  return {
    apiKey: VITE_FIREBASE_API_KEY,
    authDomain: VITE_FIREBASE_AUTH_DOMAIN,
    projectId: VITE_FIREBASE_PROJECT_ID,
    appId: VITE_FIREBASE_APP_ID,
    storageBucket: VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID
  };
}

function ensureFirebaseApp(): FirebaseApp {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (getApps().length) {
    firebaseApp = getApps()[0];
  } else {
    const config = assertFirebaseConfig();
    console.log("Initializing Firebase app with project:", config.projectId);
    firebaseApp = initializeApp(config);
  }
  console.log("Firebase app initialized:", firebaseApp?.name);
  return firebaseApp;
}

function getDb(): Firestore {
  if (!firestoreDb) {
    const app = ensureFirebaseApp();
    console.log("Initializing Firestore for app:", app.name);
    firestoreDb = getFirestore(app);
  }
  console.log("Firestore ready:", Boolean(firestoreDb));
  return firestoreDb;
}

function buildDocRef(initialPsbt: string) {
  const safeId = encodeURIComponent(initialPsbt);
  return doc(collection(getDb(), COLLECTION_NAME), safeId);
}

function normalizeOwnerRecords(
  rawOwners: unknown,
  fallbackPublicKeys: string[] | undefined
): MultisigOwnerRecord[] {
  if (Array.isArray(rawOwners)) {
    return rawOwners
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return undefined;
        }
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.publicKey !== "string") {
          return undefined;
        }
        return {
          publicKey: candidate.publicKey.trim(),
          ...(typeof candidate.label === "string" ? { label: candidate.label } : {})
        };
      })
      .filter((owner): owner is MultisigOwnerRecord => Boolean(owner?.publicKey));
  }

  if (Array.isArray(fallbackPublicKeys)) {
    return fallbackPublicKeys
      .map((key) => (typeof key === "string" ? key.trim() : ""))
      .filter((key) => key.length > 0)
      .map((publicKey) => ({ publicKey }));
  }

  return [];
}

function ownerRecordToPublicKeys(records: MultisigOwnerRecord[]): string[] {
  return records.map((record) => record.publicKey).filter((key) => key.length > 0);
}

function normalizeSignatures(rawSignatures: unknown): MultisigSignature[] {
  if (!Array.isArray(rawSignatures)) {
    return [];
  }
  return rawSignatures
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.publicKey !== "string" || !Array.isArray(candidate.signatures)) {
        return undefined;
      }
      const record: MultisigSignature = {
        publicKey: candidate.publicKey.trim(),
        signatures: (candidate.signatures as unknown[])
          .map((value) => (typeof value === "string" ? value : ""))
          .filter((value) => value.length > 0)
      };
      if (typeof candidate.timestamp === "number") {
        record.timestamp = candidate.timestamp;
      }
      return record;
    })
    .filter((value): value is MultisigSignature => {
      if (!value) {
        return false;
      }
      return Array.isArray(value.signatures) && value.signatures.length > 0;
    });
}

function safeDecodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function mapDocToRecord(docSnap: QueryDocumentSnapshot<DocumentData>): MultisigTxRecord {
  const data = docSnap.data() as Partial<MultisigTxRecord> & { owners?: unknown; ownerPublicKeys?: unknown };
  const network = (data.network as ZcashNetwork) ?? "testnet";
  const owners = normalizeOwnerRecords(
    data.owners,
    Array.isArray(data.ownerPublicKeys) ? (data.ownerPublicKeys as string[]) : undefined
  );
  const signatures = normalizeSignatures(data.signatures);
  const utxos = Array.isArray(data.utxos) ? (data.utxos as RpcUtxo[]) : [];
  return {
    initialPsbt: typeof data.initialPsbt === "string" ? data.initialPsbt : safeDecodeId(docSnap.id),
    owners,
    ownerPublicKeys: ownerRecordToPublicKeys(owners),
    signatures,
    fromAddress: typeof data.fromAddress === "string" ? data.fromAddress : "",
    toAddress: typeof data.toAddress === "string" ? data.toAddress : "",
    amount: typeof data.amount === "number" ? data.amount : 0,
    fee: typeof data.fee === "number" ? data.fee : 0,
    network,
    redeemScript: typeof data.redeemScript === "string" ? data.redeemScript : "",
    utxos,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
    executedTxId: typeof data.executedTxId === "string" ? data.executedTxId : undefined,
    executedAt: typeof data.executedAt === "number" ? data.executedAt : undefined
  };
}

export async function saveMultisigTx(record: MultisigTxRecord): Promise<void> {
  if (!record.initialPsbt) {
    throw new Error("initialPsbt обязателен для сохранения транзакции");
  }

  const normalizedOwners = normalizeOwnerRecords(record.owners, record.ownerPublicKeys);
  const sanitizedUtxos = (record.utxos ?? []).map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    amount: utxo.amount,
    ...(utxo.scriptPubKey ? { scriptPubKey: utxo.scriptPubKey } : {}),
    ...(typeof utxo.confirmations === "number" ? { confirmations: utxo.confirmations } : {}),
    ...(typeof utxo.spendable === "boolean" ? { spendable: utxo.spendable } : {}),
    ...(typeof utxo.solvable === "boolean" ? { solvable: utxo.solvable } : {})
  }));

  try {
  console.log("SAVE TX", record);
  await setDoc(
    buildDocRef(record.initialPsbt),
    {
      initialPsbt: record.initialPsbt,
      owners: normalizedOwners.map((owner) =>
        owner.label
          ? { publicKey: owner.publicKey, label: owner.label }
          : { publicKey: owner.publicKey }
      ),
      ownerPublicKeys: ownerRecordToPublicKeys(normalizedOwners),
      signatures: record.signatures,
      fromAddress: record.fromAddress ?? "",
      toAddress: record.toAddress ?? "",
      amount: record.amount ?? 0,
      fee: record.fee ?? 0,
      network: record.network,
      redeemScript: record.redeemScript ?? "",
      utxos: sanitizedUtxos,
      createdAt: record.createdAt ?? Date.now(),
      executedTxId: record.executedTxId ?? null,
      executedAt: record.executedAt ?? null
    },
      { merge: true }
    );
    console.log("SAVED TX SUCCESS", record);
  } catch (error) {
    console.error("ERROR SAVING!!! TX", error);
    throw error;
  }
}

export async function deleteMultisigTx(initialPsbt: string): Promise<void> {
  if (!initialPsbt) {
    return;
  }
  await deleteDoc(buildDocRef(initialPsbt));
}

export async function getMultisigTx(initialPsbt: string): Promise<MultisigTxRecord | null> {
  if (!initialPsbt) {
    return null;
  }
  const snapshot = await getDoc(buildDocRef(initialPsbt));
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data();
  const network = (data.network as ZcashNetwork) ?? "testnet";
  const owners = normalizeOwnerRecords(
    data.owners,
    Array.isArray(data.ownerPublicKeys) ? (data.ownerPublicKeys as string[]) : undefined
  );
  return {
    initialPsbt: data.initialPsbt ?? initialPsbt,
    signatures: normalizeSignatures(data.signatures),
    owners,
    ownerPublicKeys: ownerRecordToPublicKeys(owners),
    fromAddress: data.fromAddress ?? "",
    toAddress: data.toAddress ?? "",
    amount: data.amount ?? 0,
    fee: data.fee ?? 0,
    network,
    redeemScript: data.redeemScript ?? "",
    utxos: data.utxos ?? [],
    createdAt: data.createdAt,
    executedTxId: data.executedTxId,
    executedAt: data.executedAt
  };
}

export async function getUserTxs(ownerPublicKey: string): Promise<MultisigTxRecord[]> {
  if (!ownerPublicKey) {
    return [];
  }
  console.log("GET USER TXS", ownerPublicKey);
  const txsQuery = query(
    collection(getDb(), COLLECTION_NAME),
    where("ownerPublicKeys", "array-contains", ownerPublicKey)
  );
  console.log("TXS QUERY", txsQuery);
  const snapshot = await getDocs(txsQuery);
  console.log("TXS SNAPSHOT", snapshot);
  return snapshot.docs.map(mapDocToRecord);
}

export async function updateMultisigTx(
  initialPsbt: string,
  data: Partial<MultisigTxRecord>
): Promise<void> {
  if (!initialPsbt) {
    throw new Error("initialPsbt обязателен для обновления");
  }
  await setDoc(buildDocRef(initialPsbt), data, { merge: true });
}

