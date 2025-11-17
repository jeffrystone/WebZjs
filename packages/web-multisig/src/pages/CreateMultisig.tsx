import { FormEvent, useEffect, useMemo, useState } from "react";
import { useWallet } from "../state/WalletContext";
import { generateP2shMultisigAddress } from "../lib/p2sh";
import { useTransparentBalance } from "../hooks/useTransparentBalance";
import { sendTransparentMultisig } from "../lib/sendTransparentMultisig";
import type { ZcashNetwork } from "../services/zcashRpc";
import {
  createLocalMultisig,
  listLocalMultisigs,
  type MultisigOwnerInfo,
  type SupportedNetwork
} from "../services/localMultisigStorage";
import { DEFAULT_ZIP48_PATHS } from "../constants/zip48";

interface OwnerInput extends MultisigOwnerInfo {
  id: string;
}

const createOwnerInput = (publicKey = "", derivationPath = ""): OwnerInput => ({
  id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `owner_${Math.random().toString(36).slice(2)}`,
  publicKey,
  derivationPath
});

const CreateMultisig = () => {
  const { addresses } = useWallet();
  const [network, setNetwork] = useState<ZcashNetwork>("testnet");
  const [ownersInput, setOwnersInput] = useState<OwnerInput[]>(() => [
    createOwnerInput(addresses[0] ?? "", DEFAULT_ZIP48_PATHS["testnet"])
  ]);
  const [threshold, setThreshold] = useState(2);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [fee, setFee] = useState("0.0001");
  const [signingKeysInput, setSigningKeysInput] = useState("");
  const [txResult, setTxResult] = useState<{ txId?: string; rawHex?: string; error?: string }>();
  const [isSending, setIsSending] = useState(false);
  const [label, setLabel] = useState("");
  const [saveResult, setSaveResult] = useState<{ success?: string; error?: string }>();

  useEffect(() => {
    setOwnersInput((prev) => {
      if (prev.length === 1 && !prev[0].publicKey.trim() && addresses[0]) {
        return [createOwnerInput(addresses[0], DEFAULT_ZIP48_PATHS[network])];
      }
      return prev;
    });
  }, [addresses, network]);

  const participants = useMemo(
    () =>
      ownersInput
        .map((owner) => owner.publicKey.trim())
        .filter((line) => line.length > 0),
    [ownersInput]
  );

  const effectiveThreshold = Math.min(Math.max(threshold, 1), participants.length || 1);

  useEffect(() => {
    if (threshold !== effectiveThreshold) {
      setThreshold(effectiveThreshold);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveThreshold]);

  const multisig = useMemo(() => {
    if (participants.length === 0) {
      return undefined;
    }
    return generateP2shMultisigAddress(participants, effectiveThreshold);
  }, [participants, effectiveThreshold]);

  const balanceState = useTransparentBalance(multisig?.address, multisig?.redeemScript, network);

  const updateOwner = (id: string, field: keyof MultisigOwnerInfo, value: string) => {
    setOwnersInput((prev) =>
      prev.map((owner) => (owner.id === id ? { ...owner, [field]: value } : owner))
    );
  };

  const addOwner = () => {
    setOwnersInput((prev) => [...prev, createOwnerInput("", DEFAULT_ZIP48_PATHS[network])]);
  };

  const removeOwner = (id: string) => {
    setOwnersInput((prev) => (prev.length <= 1 ? prev : prev.filter((owner) => owner.id !== id)));
  };

  const handleSaveLocal = () => {
    if (!multisig) {
      setSaveResult({ error: "Сначала сгенерируйте мультисиг" });
      return;
    }
    try {
      const normalizedOwners = ownersInput
        .map((owner) => ({
          publicKey: owner.publicKey.trim(),
          derivationPath: owner.derivationPath.trim() || DEFAULT_ZIP48_PATHS[network]
        }))
        .filter((owner) => owner.publicKey.length > 0);
      if (normalizedOwners.length === 0) {
        setSaveResult({ error: "Добавьте хотя бы одного владельца" });
        return;
      }

      const normalizedKeys = normalizedOwners.map((owner) => owner.publicKey).sort();

      const existing = listLocalMultisigs();
      const collision = existing.find((item) => {
        if (item.threshold !== effectiveThreshold || item.owners.length !== normalizedKeys.length) {
          return false;
        }
        const itemKeys = item.owners.map((owner) => owner.publicKey).sort();
        return itemKeys.every((key, index) => key === normalizedKeys[index]);
      });
      if (collision) {
        setSaveResult({ error: "Такой мультисиг уже сохранён локально" });
        return;
      }

      createLocalMultisig({
        label: label.trim() || undefined,
        address: multisig.address,
        redeemScript: multisig.redeemScript,
        owners: normalizedOwners,
        threshold: effectiveThreshold,
        network
      });
      setSaveResult({ success: "Мультисиг сохранён локально" });
    } catch (error) {
      setSaveResult({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!multisig) {
      setTxResult({ error: "Сначала создайте мультисиг-адрес" });
      return;
    }

    const parsedAmount = Number(amount);
    const parsedFee = Number(fee);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setTxResult({ error: "Введите корректную сумму" });
      return;
    }
    if (!Number.isFinite(parsedFee) || parsedFee < 0) {
      setTxResult({ error: "Введите корректную комиссию" });
      return;
    }
    const signingKeys = signingKeysInput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setIsSending(true);
    setTxResult(undefined);
    try {
      const tx = await sendTransparentMultisig({
        address: multisig.address,
        redeemScript: multisig.redeemScript,
        amount: parsedAmount,
        fee: parsedFee,
        toAddress: recipient,
        signingKeys,
        threshold: effectiveThreshold,
        network
      });
      setTxResult({ txId: tx.txId, rawHex: tx.rawHex });
      await balanceState.refresh();
    } catch (err) {
      setTxResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="panel">
      <h2>Create Multisig Address</h2>
      <p>Добавьте владельцев (публичный ключ). Путь ZIP-48 задаётся автоматически.</p>
      {addresses.length > 0 && (
        <p style={{ marginTop: "-0.5rem", color: "#475569" }}>
          Полученный адрес Snap: {addresses[0]}. Сконвертируйте его в ZIP-48 публичный ключ перед добавлением.
        </p>
      )}

      <div className="field">
        <label>Network</label>
        <select value={network} onChange={(event) => setNetwork(event.target.value as ZcashNetwork)}>
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>
      </div>

      <div className="owners-grid">
        {ownersInput.map((owner, index) => (
          <div key={owner.id} className="owner-card">
            <div className="field" style={{ marginBottom: "0.5rem" }}>
              <label>Public key #{index + 1}</label>
              <textarea
                value={owner.publicKey}
                onChange={(event) => updateOwner(owner.id, "publicKey", event.target.value)}
                spellCheck={false}
                placeholder="0334..."
                style={{ minHeight: "80px" }}
              />
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Путь: <code>{owner.derivationPath || DEFAULT_ZIP48_PATHS[network]}</code>
            </p>
            {ownersInput.length > 1 && (
              <button
                type="button"
                className="link"
                style={{ alignSelf: "flex-start" }}
                onClick={() => removeOwner(owner.id)}
              >
                Удалить владельца
              </button>
            )}
          </div>
        ))}
        <button type="button" className="secondary" onClick={addOwner} style={{ alignSelf: "flex-start" }}>
          Добавить владельца
        </button>
      </div>

      <div className="field">
        <label>Threshold (m of n)</label>
        <input
          type="number"
          min={1}
          max={participants.length || 1}
          value={effectiveThreshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <label>Generated address</label>
        <div className="address-box">{multisig?.address ?? "Not enough data"}</div>
      </div>

      <div className="field">
        <label>Redeem Script</label>
        <div className="address-box" style={{ wordBreak: "break-all" }}>
          {multisig?.redeemScript ?? "—"}
        </div>
      </div>

      <div className="field">
        <label>Название мультисига (локально)</label>
        <input type="text" placeholder="Например, Treasury 2025" value={label} onChange={(event) => setLabel(event.target.value)} />
        <button className="secondary" style={{ marginTop: "0.5rem" }} onClick={handleSaveLocal} disabled={!multisig}>
          Сохранить локально
        </button>
        {saveResult?.success && <p style={{ color: "#16a34a", marginTop: "0.5rem" }}>{saveResult.success}</p>}
        {saveResult?.error && <p style={{ color: "#dc2626", marginTop: "0.5rem" }}>{saveResult.error}</p>}
      </div>

      <div className="field">
        <label>Transparent balance</label>
        <div className="address-box">
          {balanceState.loading
            ? "Загрузка..."
            : `${balanceState.balance.toFixed(8)} ZEC`}
        </div>
        <button
          className="secondary"
          style={{ marginTop: "0.5rem" }}
          disabled={!multisig || balanceState.loading}
          onClick={() => balanceState.refresh()}
        >
          Обновить баланс
        </button>
        {balanceState.error && (
          <p style={{ color: "#dc2626", marginTop: "0.5rem" }}>{balanceState.error}</p>
        )}
      </div>

      <hr style={{ margin: "2rem 0" }} />

      <h3>Sign & Send Transparent Transaction</h3>
      <form onSubmit={handleSend} className="send-form">
        <div className="field">
          <label>Recipient address</label>
          <input
            type="text"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Amount (ZEC)</label>
          <input
            type="number"
            step="0.00000001"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Fee (ZEC)</label>
          <input
            type="number"
            step="0.00000001"
            min="0"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Signing keys (WIF или HEX, по одному в строке)</label>
          <textarea
            value={signingKeysInput}
            onChange={(event) => setSigningKeysInput(event.target.value)}
            spellCheck={false}
            placeholder="L2abc...&#10;Kx123...&#10;0xabcd..."
          />
        </div>

        <div className="button-row">
          <button type="submit" disabled={isSending}>
            {isSending ? "Отправка..." : "Подписать и отправить"}
          </button>
        </div>
      </form>

      {txResult?.txId && (
        <div className="field">
          <label>Broadcast result</label>
          <div className="address-box">
            <strong>txId:</strong> {txResult.txId}
            <br />
            <strong>raw:</strong> {txResult.rawHex}
          </div>
        </div>
      )}

      {txResult?.error && (
        <div className="address-box" style={{ marginTop: "1rem", color: "#dc2626" }}>
          {txResult.error}
        </div>
      )}
    </section>
  );
};

export default CreateMultisig;

