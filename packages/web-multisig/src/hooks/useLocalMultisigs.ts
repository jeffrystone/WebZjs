import { useCallback, useEffect, useState } from "react";
import {
  listLocalMultisigs,
  type StoredLocalMultisig,
  MULTISIG_STORAGE_EVENT
} from "../services/localMultisigStorage";

export function useLocalMultisigs() {
  const [items, setItems] = useState<StoredLocalMultisig[]>([]);

  const refresh = useCallback(() => {
    setItems(listLocalMultisigs());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = () => refresh();
    window.addEventListener(MULTISIG_STORAGE_EVENT, handler);
    return () => window.removeEventListener(MULTISIG_STORAGE_EVENT, handler);
  }, [refresh]);

  return {
    items,
    refresh
  };
}

