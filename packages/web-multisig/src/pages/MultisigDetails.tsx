import { Buffer } from "buffer";
import { FormEvent, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getLocalMultisig, StoredLocalMultisig, type MultisigOwnerInfo } from "../services/localMultisigStorage";
import { useTransparentBalance } from "../hooks/useTransparentBalance";
import { Modal } from "../components/Modal";
import {
  buildUnsignedTransaction,
  computeInputSighashes,
  finalizeTransactionWithSignatures
} from "../lib/transactions";
import {
  saveMultisigTx,
  updateMultisigTx,
  type MultisigOwnerRecord,
  type MultisigSignature,
  type MultisigTxRecord
} from "../services/firebaseService";
import { DEFAULT_ZIP48_PATHS } from "../constants/zip48";
import { TransactionList } from "../components/TransactionList";
import { useInvokeSnap } from "../hooks/snaps/useInvokeSnap";
import { broadcastRawTransaction, type RpcUtxo } from "../services/zcashRpc";

const FIXED_FEE = 0.02;

const MultisigDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("0.25");
  const [destination, setDestination] = useState("t2KgNAC63mvqn6XFxNv6PXyzDCZ45FuzmT2");
  const [utxoTxId, setUtxoTxId] = useState("ff451f7d155356226889d982a14f40ec861683db88c27e2c39b812c11a0f9ab2");
  const [utxoVout, setUtxoVout] = useState("0");
  const [utxoAmount, setUtxoAmount] = useState("0.3");
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const record = useMemo<StoredLocalMultisig | null>(() => {
    if (!id) {
      return null;
    }
    return getLocalMultisig(id) ?? null;
  }, [id]);

  const balance = useTransparentBalance(record?.address, record?.redeemScript, record?.network ?? "testnet");
  const invokeSnap = useInvokeSnap();

  if (!record) {
    return (
      <section className="panel">
        <h2>Мультисиг не найден</h2>
        <p className="muted">Похоже, запись была удалена. Вернитесь к списку и попробуйте снова.</p>
        <button className="secondary" onClick={() => navigate("/multisig")}>
          К списку
        </button>
      </section>
    );
  }

  const availableToSend = Math.max(balance.balance - FIXED_FEE, 0);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setActionError(undefined);
    setActionMessage(undefined);

    if (!record.redeemScript) {
      setActionError("Нет redeem script для построения транзакции");
      return;
    }
    const parsedAmount = Number(amountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setActionError("Введите корректную сумму");
      return;
    }
    // if (parsedAmount > availableToSend) {
    //   setActionError("Недостаточно средств с учётом комиссии 0.02 ZEC");
    //   return;
    // }
    if (!destination) {
      setActionError("Введите адрес получателя");
      return;
    }
    const parsedUtxoAmount = Number(utxoAmount);
    const parsedVout = Number(utxoVout);
    if (!utxoTxId || utxoTxId.length < 10) {
      setActionError("Укажите txid UTXO");
      return;
    }
    if (!Number.isInteger(parsedVout) || parsedVout < 0) {
      setActionError("Укажите корректный vout");
      return;
    }
    if (!Number.isFinite(parsedUtxoAmount) || parsedUtxoAmount <= 0) {
      setActionError("Укажите размер (amount) UTXO");
      return;
    }

    setIsProcessing(true);
    try {
      console.log('UTXO', utxoTxId, parsedVout, parsedUtxoAmount);
      const manualUtxos: RpcUtxo[] = [
        {
          txid: utxoTxId.trim(),
          vout: parsedVout,
          amount: parsedUtxoAmount
        }
      ];
      console.log('MANUAL UTXOS', manualUtxos);
      const unsigned = buildUnsignedTransaction({
        network: record.network,
        utxos: manualUtxos,
        amount: parsedAmount,
        fee: FIXED_FEE,
        fromAddress: record.address,
        toAddress: destination,
        redeemScript: record.redeemScript
      });
      console.log('UNSIGNED', unsigned);
      await saveMultisigTx({
        initialPsbt: unsigned.txHex,
        signatures: [],
        owners: record.owners.map((owner) => ({
          publicKey: owner.publicKey,
          ...(owner.label ? { label: owner.label } : {})
        })),
        ownerPublicKeys: record.owners.map((owner) => owner.publicKey),
        fromAddress: record.address,
        toAddress: destination,
        amount: parsedAmount,
        fee: FIXED_FEE,
        network: record.network,
        redeemScript: record.redeemScript,
        utxos: unsigned.inputs,
        createdAt: Date.now()
      });
      console.log('SAVED TX');
      setModalOpen(false);
      setAmountInput("");
      setDestination("");
      setUtxoTxId("");
      setUtxoVout("");
      setUtxoAmount("");
      setActionMessage("Транзакция создана. Подпишите её через MetaMask.");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      console.error('ERROR', err);
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSign = async (tx: MultisigTxRecord, owner: MultisigOwnerInfo) => {
    setActionError(undefined);
    try {
      console.log('SIGN', tx, owner);
      const sighashes = computeInputSighashes(tx.initialPsbt, tx.redeemScript, tx.network, tx.utxos);
      console.log('SIGHASHES', sighashes);
      const derivationPath =
        owner.derivationPath && owner.derivationPath.length > 0
          ? owner.derivationPath
          : DEFAULT_ZIP48_PATHS[record.network];
      console.log("SIGN REQUEST", {
        owner: owner.publicKey,
        derivationPath,
        sighashesCount: sighashes.length,
        tx: tx.initialPsbt.slice(0, 16)
      });
      const signatures = (await invokeSnap({
        method: "signTransparent",
        params: {
          derivationPath,
          sighashes,
          details: {
            toAddress: tx.toAddress,
            amount: tx.amount.toString(),
            network: tx.network
          }
        }
      })) as string[];

      const nextSignatures = [
        ...tx.signatures.filter((sig) => sig.publicKey !== owner.publicKey),
        {
          publicKey: owner.publicKey,
          signatures,
          timestamp: Date.now()
        }
      ];

      await updateMultisigTx(tx.initialPsbt, { signatures: nextSignatures });
      setActionMessage("Подпись сохранена.");
      setRefreshKey((value) => value + 1);
    } catch (err) {
      console.error("SIGN ERROR", err);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExecute = async (tx: MultisigTxRecord) => {
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const inputCount = tx.utxos.length;
      const orderedOwners = [...record.owners].sort((a, b) =>
        Buffer.from(a.publicKey, "hex").compare(Buffer.from(b.publicKey, "hex"))
      );
      const orderedSignatureRecords = orderedOwners
        .map((owner) => tx.signatures.find((sig) => sig.publicKey === owner.publicKey))
        .filter(
          (sig): sig is MultisigSignature =>
            Boolean(sig) && Array.isArray(sig?.signatures) && sig.signatures.length === inputCount
        )
        .slice(0, record.threshold);
      const orderedSignatureSets = orderedSignatureRecords.map((sig) => sig.signatures);

      if (orderedSignatureSets.length < record.threshold) {
        throw new Error("Недостаточно подписей для исполнения транзакции");
      }

      const rawHex = finalizeTransactionWithSignatures({
        txHex: tx.initialPsbt,
        redeemScript: tx.redeemScript,
        network: tx.network,
        orderedSignatureSets
      });

      const txId = await broadcastRawTransaction(rawHex, tx.network);
      await updateMultisigTx(tx.initialPsbt, {
        executedTxId: txId,
        executedAt: Date.now()
      });
      setActionMessage(`Транзакция отправлена: ${txId}`);
      setRefreshKey((value) => value + 1);
      await balance.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel">
      <button className="link" onClick={() => navigate("/multisig")} style={{ marginBottom: "1rem" }}>
        ← Список мультисигов
      </button>

      <div className="panel-header">
        <div>
          <p className="muted">{record.network.toUpperCase()}</p>
          <h2>{record.label ?? "Без названия"}</h2>
        </div>
        <div className="badge">
          Порог {record.threshold} из {record.owners.length}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <h4>Адрес</h4>
          <div className="address-box">
            {record.address}
            <a
              className="explorer-link"
              href={`https://blockexplorer.one/zcash/${record.network}/address/${record.address}`}
              target="_blank"
              rel="noreferrer"
            >
              ↗
            </a>
          </div>
        </div>
        <div>
          <h4>Redeem script</h4>
          <div className="address-box">{record.redeemScript ?? "—"}</div>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <h4>Владельцы ({record.owners.length})</h4>
          <ul className="owners-list">
            {record.owners.map((owner, index) => (
              <li key={`${owner.publicKey}-${index}`}>
                <strong>PK:</strong> <code>{owner.publicKey}</code>
                <br />
                <strong>Path:</strong> <code>{owner.derivationPath || DEFAULT_ZIP48_PATHS[record.network]}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Баланс</h4>
          <div className="balance-box">
            {balance.loading ? "Загрузка..." : `${balance.balance.toFixed(8)} ZEC`}
          </div>
          <small className="muted">
            Доступно к отправке: {(availableToSend > 0 ? availableToSend : 0).toFixed(8)} ZEC
          </small>
          <button className="secondary" style={{ marginTop: "0.5rem" }} onClick={() => balance.refresh()} disabled={balance.loading}>
            Обновить
          </button>
        </div>
      </div>

      <div className="button-row" style={{ marginTop: "1.5rem" }}>
        <button onClick={() => setModalOpen(true)} /*disabled={balance.balance <= FIXED_FEE}*/>
          Создать транзакцию
        </button>
      </div>

      {actionMessage && (
        <div className="success-box" style={{ marginTop: "1rem" }}>
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div className="error-box" style={{ marginTop: "1rem" }}>
          {actionError}
        </div>
      )}

      {modalOpen && (
        <Modal title="Отправка средств" onClose={() => setModalOpen(false)}>
          <form className="modal-form" onSubmit={handleSubmit}>
            <label>
              Сумма (ZEC)
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                required
              />
            </label>
            <label>
              Адрес получателя
              <input
                type="text"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                required
              />
            </label>
            <label>
              UTXO txid
              <input
                type="text"
                value={utxoTxId}
                onChange={(event) => setUtxoTxId(event.target.value)}
                placeholder="4db3...3967"
                required
              />
            </label>
            <label>
              UTXO vout
              <input
                type="number"
                min="0"
                value={utxoVout}
                onChange={(event) => setUtxoVout(event.target.value)}
                required
              />
            </label>
            <label>
              Размер UTXO (ZEC)
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={utxoAmount}
                onChange={(event) => setUtxoAmount(event.target.value)}
                required
              />
            </label>
            <p className="muted">Комиссия сети: {FIXED_FEE} ZEC</p>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="secondary" onClick={() => setModalOpen(false)}>
                Отмена
              </button>
              <button type="submit" disabled={isProcessing}>
                {isProcessing ? "Создание..." : "Подтвердить"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <TransactionList
        owners={record.owners}
        threshold={record.threshold}
        refreshKey={refreshKey}
        onSign={handleSign}
        onExecute={handleExecute}
      />
    </section>
  );
};

export default MultisigDetails;


