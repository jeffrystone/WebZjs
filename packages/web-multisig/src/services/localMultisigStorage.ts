export type SupportedNetwork = "mainnet" | "testnet";

export interface MultisigOwnerInfo {
  publicKey: string;
  derivationPath: string;
  label?: string;
}

export interface LocalMultisigDraft {
  label?: string;
  description?: string;
  address: string;
  redeemScript?: string;
  owners: MultisigOwnerInfo[];
  threshold: number;
  network: SupportedNetwork;
}

export interface StoredLocalMultisig extends LocalMultisigDraft {
  id: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "zec:multisig:list";
const STORAGE_EVENT = "multisig-storage-updated";
const DEFAULT_PATHS: Record<SupportedNetwork, string> = {
  mainnet: "m/48'/133'/0'/133000'/0/0",
  testnet: "m/48'/1'/0'/133000'/0/0"
};

export const MULTISIG_STORAGE_EVENT = STORAGE_EVENT;

function getNow(): number {
  return Date.now();
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msig_${Math.random().toString(36).slice(2)}_${getNow().toString(36)}`;
}

function normalizeOwners(
  rawOwners: unknown,
  legacyPublicKeys: unknown,
  network: SupportedNetwork
): MultisigOwnerInfo[] {
  if (Array.isArray(rawOwners)) {
    return rawOwners
      .map((item) => {
        if (!item || typeof item !== "object") {
          return undefined;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.publicKey !== "string") {
          return undefined;
        }
        const derivationPath =
          typeof record.derivationPath === "string" && record.derivationPath.trim().length > 0
            ? record.derivationPath.trim()
            : DEFAULT_PATHS[network];
        return {
          publicKey: record.publicKey.trim(),
          derivationPath,
          label: typeof record.label === "string" ? record.label : undefined
        };
      })
      .filter((owner): owner is MultisigOwnerInfo => Boolean(owner?.publicKey));
  }

  if (Array.isArray(legacyPublicKeys)) {
    return legacyPublicKeys
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .map((publicKey) => ({ publicKey, derivationPath: DEFAULT_PATHS[network] }));
  }

  return [];
}

function readStorage(): StoredLocalMultisig[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return undefined;
        }
        const record = entry as Record<string, unknown> & { owners?: unknown; publicKeys?: unknown };
        if (typeof record.id !== "string") {
          return undefined;
        }

        const owners = normalizeOwners(
          record.owners,
          record.publicKeys,
          (record.network as SupportedNetwork) ?? "testnet"
        );
        const { publicKeys: _legacyPublicKeys, owners: _ignoredOwners, ...rest } = record;
        return {
          ...(rest as StoredLocalMultisig),
          owners
        };
      })
      .filter((entry): entry is StoredLocalMultisig => Boolean(entry));
  } catch {
    return [];
  }
}

function persistStorage(records: StoredLocalMultisig[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  notifyStorageChange();
}

function notifyStorageChange() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

export function listLocalMultisigs(): StoredLocalMultisig[] {
  return readStorage();
}

export function getLocalMultisig(id: string): StoredLocalMultisig | undefined {
  return readStorage().find((entry) => entry.id === id);
}

function normalizeDraftOwners(owners: MultisigOwnerInfo[], network: SupportedNetwork): MultisigOwnerInfo[] {
  return owners
    .map((owner) => ({
      publicKey: owner.publicKey.trim(),
      derivationPath:
        owner.derivationPath && owner.derivationPath.trim().length > 0
          ? owner.derivationPath.trim()
          : DEFAULT_PATHS[network],
      label: owner.label?.trim()
    }))
    .filter((owner) => owner.publicKey.length > 0);
}

export function createLocalMultisig(draft: LocalMultisigDraft): StoredLocalMultisig {
  const now = getNow();
  const record: StoredLocalMultisig = {
    ...draft,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    owners: normalizeDraftOwners(draft.owners, draft.network),
    threshold: draft.threshold
  };

  const existing = readStorage();
  persistStorage([...existing, record]);
  return record;
}

export function updateLocalMultisig(id: string, patch: Partial<LocalMultisigDraft>): StoredLocalMultisig {
  const existing = readStorage();
  const index = existing.findIndex((entry) => entry.id === id);
  if (index === -1) {
    throw new Error(`Multisig с id ${id} не найден в localStorage`);
  }

  const current = existing[index];
  const nextOwners = patch.owners ? normalizeDraftOwners(patch.owners, current.network) : current.owners;

  const nextThreshold = patch.threshold !== undefined ? patch.threshold : current.threshold;

  const updated: StoredLocalMultisig = {
    ...current,
    ...patch,
    owners: nextOwners,
    threshold: nextThreshold,
    updatedAt: getNow()
  };

  existing[index] = updated;
  persistStorage(existing);
  return updated;
}

export function deleteLocalMultisig(id: string): void {
  const existing = readStorage();
  const filtered = existing.filter((entry) => entry.id !== id);
  persistStorage(filtered);
}

export function clearLocalMultisigs(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
  notifyStorageChange();
}

