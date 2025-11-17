import { useCallback, useEffect, useState } from "react";
import { getTransparentBalance, RpcUtxo, ZcashNetwork } from "../services/zcashRpc";

interface BalanceState {
  loading: boolean;
  balance: number;
  utxos: RpcUtxo[];
  error?: string;
}

const initialState: BalanceState = {
  loading: false,
  balance: 0,
  utxos: [],
  error: undefined
};

export function useTransparentBalance(
  address?: string,
  redeemScript?: string,
  network: ZcashNetwork = "testnet"
) {
  const [state, setState] = useState<BalanceState>(initialState);

  const refresh = useCallback(async () => {
    if (!address || !redeemScript) {
      setState(initialState);
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const result = await getTransparentBalance(address, redeemScript, network);
      setState({
        loading: false,
        balance: result.balance,
        utxos: result.utxos,
        error: undefined
      });
    } catch (err) {
      setState({
        loading: false,
        balance: 0,
        utxos: [],
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }, [address, redeemScript, network]);

  useEffect(() => {
    if (address && redeemScript) {
      refresh().catch(console.error);
    } else {
      setState(initialState);
    }
  }, [address, redeemScript, network, refresh]);

  return {
    ...state,
    refresh
  };
}


