import { ReactNode } from "react";

interface BaseCardProps {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

function CardContainer({ className = "", children, onClick }: BaseCardProps) {
  return (
    <div className={`multisig-card ${className}`} onClick={onClick} role="button" tabIndex={0}>
      {children}
    </div>
  );
}

interface MultisigCardProps {
  label: string;
  address: string;
  ownersCount: number;
  threshold: number;
  network: string;
  description?: string;
  onClick: () => void;
}

export function MultisigCard({
  label,
  address,
  ownersCount,
  threshold,
  network,
  description,
  onClick
}: MultisigCardProps) {
  return (
    <CardContainer onClick={onClick}>
      <div className="multisig-card__header">
        <div>
          <p className="muted">{network.toUpperCase()}</p>
          <h3>{label}</h3>
        </div>
        <div className="badge">
          {threshold}/{ownersCount}
        </div>
      </div>
      {description && <p className="muted">{description}</p>}
      <div className="multisig-card__address">{address}</div>
    </CardContainer>
  );
}

interface AddCardProps {
  onClick: () => void;
  text?: string;
}

export function AddMultisigCard({ onClick, text = "Добавить мультисиг" }: AddCardProps) {
  return (
    <CardContainer className="multisig-card--add" onClick={onClick}>
      <div className="add-icon">+</div>
      <p>{text}</p>
    </CardContainer>
  );
}

