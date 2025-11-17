import { useEffect, useMemo, useState } from "react";
import { getUserTxs, type MultisigTxRecord } from "../services/firebaseService";
import type { MultisigOwnerInfo } from "../services/localMultisigStorage";
import { useWallet } from "../state/WalletContext";

interface TransactionListProps {
  owners: MultisigOwnerInfo[];
  threshold: number;
  title?: string;
  refreshKey?: number;
  onSign?: (tx: MultisigTxRecord, owner: MultisigOwnerInfo) => void;
  onExecute?: (tx: MultisigTxRecord) => void;
}

function normalizePublicKeys(owners: MultisigOwnerInfo[]) {
  return owners
    .map((owner) => owner.publicKey.trim().toLowerCase())
    .filter((owner) => owner.length > 0)
    .sort();
}

function ownersMatch(txOwners: string[], target: string[]) {
  if (txOwners.length !== target.length) {
    return false;
  }
  const normalizedTx = txOwners.map((owner) => owner.trim().toLowerCase()).sort();
  return normalizedTx.length === target.length && normalizedTx.every((value, index) => value === target[index]);
}

function shortKey(key: string) {
  return key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
}

export const TransactionList = ({
  owners,
  threshold,
  title = "Транзакции",
  refreshKey,
  onSign,
  onExecute
}: TransactionListProps) => {
  const [items, setItems] = useState<MultisigTxRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const { addresses } = useWallet();
  const connectedKey = addresses[0]?.trim().toLowerCase();

  const normalizedOwners = useMemo(() => normalizePublicKeys(owners), [owners]);
  const ownerDetailsMap = useMemo(() => {
    const map = new Map<string, MultisigOwnerInfo>();
    owners.forEach((owner) => {
      map.set(owner.publicKey.trim().toLowerCase(), owner);
    });
    return map;
  }, [owners]);

  useEffect(() => {
    if (normalizedOwners.length === 0) {
      setItems([]);
      return;
    }

    let cancelled = false;

    const fetchTxs = async () => {
      setLoading(true);
      setError(undefined);
      try {
        const responses = await Promise.all(
          normalizedOwners.map(async (ownerKey) => {
            try {
              return await getUserTxs(ownerKey);
            } catch (err) {
              console.warn("Не удалось загрузить транзакции для", ownerKey, err);
              return [];
            }
          })
        );

        const merged = responses.flat();
        const dedup = new Map<string, MultisigTxRecord>();
        merged.forEach((tx) => {
          const txOwnerKeys = Array.isArray(tx.ownerPublicKeys) ? tx.ownerPublicKeys : tx.owners.map((o) => o.publicKey);
          if (!ownersMatch(txOwnerKeys, normalizedOwners)) {
            return;
          }
          if (!dedup.has(tx.initialPsbt)) {
            dedup.set(tx.initialPsbt, tx);
          }
        });
        if (!cancelled) {
          setItems(Array.from(dedup.values()));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchTxs().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [normalizedOwners, owners, refreshKey]);

  return (
    <section className="tx-list">
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <h3>{title}</h3>
          <p className="muted">Берём только записи из Firebase, где набор owners совпадает с этим мультисигом.</p>
        </div>
      </div>

      {loading && <p className="muted">Загрузка транзакций...</p>}
      {error && (
        <div className="error-box">
          Не удалось загрузить транзакции:
          <br />
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="muted">Для этого мультисига пока нет записей в Firebase.</p>
      )}

      {items.map((tx) => {
        const validSignatures = tx.signatures.filter(
          (sig) => Array.isArray(sig.signatures) && sig.signatures.length === tx.utxos.length
        );
        const signedKeys = new Set(validSignatures.map((sig) => sig.publicKey.toLowerCase()));
        const canExecute = validSignatures.length >= threshold && !tx.executedTxId;
        return (
          <div key={tx.initialPsbt} className="tx-card">
            <div className="tx-card__header">
              <div>
                <strong>{tx.amount} ZEC → {shortKey(tx.toAddress)}</strong>
                <p className="muted">Комиссия: {tx.fee} ZEC</p>
              </div>
              <div className="badge">
                {validSignatures.length}/{threshold}
              </div>
            </div>
            <code>{tx.initialPsbt}</code>
            <div className="owners-list" style={{ marginTop: "0.75rem" }}>
              {tx.owners.map((txOwner) => {
                const key = txOwner.publicKey.toLowerCase();
                const signed = signedKeys.has(key);
                const localOwner =
                  ownerDetailsMap.get(key) ?? {
                    publicKey: txOwner.publicKey,
                    derivationPath: "",
                    label: txOwner.label
                  };
                const isConnectedOwner = connectedKey === key;
                return (
                  <div key={`${tx.initialPsbt}-${txOwner.publicKey}`} className="tx-owner-row">
                    <div>
                      <strong>{localOwner.label ?? shortKey(localOwner.publicKey)}</strong>
                      <p className="muted" style={{ margin: 0 }}>
                        {localOwner.derivationPath ?? "—"}
                      </p>
                    </div>
                    {isConnectedOwner ? (
                      <button
                        className="secondary"
                        disabled={signed || !onSign}
                        onClick={() => onSign?.(tx, localOwner)}
                      >
                        {signed ? "Подписано" : "Подписать"}
                      </button>
                    ) : (
                      <span className="muted">
                        {signed ? "Подписано" : "Ожидает владельца"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {tx.executedTxId ? (
              <div className="success-box">
                Исполнено: <code>{tx.executedTxId}</code>
              </div>
            ) : (
              <div className="button-row" style={{ marginTop: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  onClick={() => onExecute?.(tx)}
                  disabled={!canExecute || !onExecute}
                >
                  Исполнить
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};

