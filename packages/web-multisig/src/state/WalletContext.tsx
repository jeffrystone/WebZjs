import { createContext, useContext, useMemo, useState, ReactNode } from "react";

interface WalletState {
  addresses: string[];
  setAddresses: (value: string[]) => void;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [addresses, setAddresses] = useState<string[]>([]);

  const value = useMemo(
    () => ({
      addresses,
      setAddresses
    }),
    [addresses]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return ctx;
};

