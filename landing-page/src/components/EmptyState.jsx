import React from 'react';

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      {Icon && <div className="empty-state-icon"><Icon size={40} /></div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && onAction && (
        <button className="btn-accent" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}
