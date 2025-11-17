import { useEffect, useMemo, useState } from "react";
import { useWallet } from "../state/WalletContext";
import { useMetaMask, useRequestSnap, useInvokeSnap } from "../hooks";
import { DEFAULT_ZIP48_PATHS } from "../constants/zip48";

const ConnectWallet = () => {
  const { addresses, setAddresses } = useWallet();
  const { isFlask, snapsDetected, installedSnap, getSnap } = useMetaMask();
  const requestSnap = useRequestSnap();
  const invokeSnap = useInvokeSnap();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const shortKey = useMemo(
    () => (key: string) => (key.length > 16 ? `${key.slice(0, 10)}...${key.slice(-6)}` : key),
    []
  );
  const [autoFetching, setAutoFetching] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    setError(undefined);
    try {
      setInfo(undefined);
      await requestSnap();
      await getSnap();
      await invokeSnap({
        method: "getViewingKey"
      });

      const defaultPath = DEFAULT_ZIP48_PATHS.testnet;
      const publicKey = (await invokeSnap({
        method: "getTransparentPublicKey",
        params: { derivationPath: defaultPath }
      })) as string;

      setAddresses([publicKey]);
      setInfo("Snap подключен. Публичный ключ добавлен в форму мультисига.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!installedSnap || addresses.length > 0 || connecting || autoFetching) {
      return;
    }

    let cancelled = false;
    const fetchKey = async () => {
      try {
        setAutoFetching(true);
        const publicKey = (await invokeSnap({
          method: "getTransparentPublicKey",
          params: { derivationPath: DEFAULT_ZIP48_PATHS.testnet }
        })) as string;
        if (!cancelled) {
          setAddresses([publicKey]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setAutoFetching(false);
        }
      }
    };

    fetchKey().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [installedSnap, addresses.length, connecting, autoFetching, invokeSnap, setAddresses]);

  return (
    <section className="panel">
      <h2>Connect Wallet</h2>
      <p>
        Для работы мультисига требуется MetaMask Flask со Snap `@chainsafe/webzjs-zcash-snap`. Нажмите кнопку ниже, чтобы
        установить Snap и получить прозрачные адреса из кошелька.
      </p>

      {!snapsDetected && (
        <p style={{ color: "#b45309" }}>
          Провайдер MetaMask не обнаружен. Убедитесь, что расширение установлено и страница открыта в поддерживаемом
          браузере.
        </p>
      )}

      {snapsDetected && !isFlask && (
        <p style={{ color: "#b45309" }}>
          Обнаружена обычная версия MetaMask. Установите MetaMask Flask, чтобы работать со Snap.
        </p>
      )}

      <div className="status-row">
        <div className={`status-indicator ${installedSnap ? "success" : "pending"}`} />
        <span>
          {installedSnap ? (
            <span>
              Snap подключен. Используйте собственные ключи ZIP-48.
              {addresses.length > 0 && (
                <>
                  <br />
                  Текущий публичный ключ: <code>{shortKey(addresses[0])}</code>
                </>
              )}
            </span>
          ) : (
            "Подключите MetaMask Snap, чтобы продолжить."
          )}
        </span>
      </div>

      {!installedSnap && (
        <div className="button-row" style={{ marginTop: "1rem" }}>
          <button onClick={handleConnect} disabled={!snapsDetected || !isFlask || connecting}>
            {connecting ? "Подключение..." : "Подключить MetaMask Snap"}
          </button>
        </div>
      )}

      {info && (
        <div className="address-box" style={{ marginTop: "1rem", color: "#059669" }}>
          {info}
        </div>
      )}

      {error && (
        <div className="address-box" style={{ marginTop: "1rem", color: "#dc2626" }}>
          {error}
        </div>
      )}
    </section>
  );
};

export default ConnectWallet;


