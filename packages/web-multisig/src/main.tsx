import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./shims/nodeGlobals";
import App from "./App";
import { WalletProvider } from "./state/WalletContext";
import { MetaMaskProvider } from "./context/MetamaskContext";
import "./styles.css";

const Main = () => {
  useEffect(() => {
    document.title = "Zcash Multisig Demo";
  }, []);

  return (
    <StrictMode>
      <BrowserRouter>
        <MetaMaskProvider>
          <WalletProvider>
            <App />
          </WalletProvider>
        </MetaMaskProvider>
      </BrowserRouter>
    </StrictMode>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(<Main />);

