import { useNavigate } from "react-router-dom";
import { useLocalMultisigs } from "../hooks/useLocalMultisigs";
import { AddMultisigCard, MultisigCard } from "../components/MultisigCard";

const MultisigList = () => {
  const navigate = useNavigate();
  const { items } = useLocalMultisigs();

  const handleAdd = () => navigate("/multisig/new");

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Ваши мультисиг-кошельки</h2>
          <p className="muted">Храним только локально, без синхронизации с сервером.</p>
        </div>
      </div>

      <div className="multisig-grid">
        <AddMultisigCard onClick={handleAdd} />
        {items.map((item) => (
          <MultisigCard
            key={item.id}
            label={item.label ?? `Мультисиг ${item.id.slice(0, 4)}`}
            address={item.address}
            ownersCount={item.owners.length}
            threshold={item.threshold}
            network={item.network}
            description={item.description}
            onClick={() => navigate(`/multisig/${item.id}`)}
          />
        ))}
      </div>

      {items.length === 0 && (
        <p style={{ marginTop: "1.5rem" }} className="muted">
          Пока нет сохранённых мультисигов. Нажмите на карточку с плюсом, чтобы добавить новый.
        </p>
      )}
    </section>
  );
};

export default MultisigList;

