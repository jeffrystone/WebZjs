import { Link, Route, Routes, Navigate } from "react-router-dom";
import ConnectWallet from "./pages/ConnectWallet";
import CreateMultisig from "./pages/CreateMultisig";
import MultisigList from "./pages/MultisigList";
import MultisigDetails from "./pages/MultisigDetails";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span>Zcash Multisig Demo</span>
        </div>
        <nav>
          <Link to="/connect">Connect</Link>
          <Link to="/multisig">Multisigs</Link>
          <Link to="/multisig/new">Add</Link>
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/connect" replace />} />
          <Route path="/connect" element={<ConnectWallet />} />
          <Route path="/multisig" element={<MultisigList />} />
          <Route path="/multisig/new" element={<CreateMultisig />} />
          <Route path="/multisig/:id" element={<MultisigDetails />} />
        </Routes>
      </main>
    </div>
  );
}

