import React from 'react';
import { CheckCircle, AlertCircle, XCircle, RefreshCw, Loader2 } from 'lucide-react';

export default function ConnectedAccount({ name, icon: Icon, connected, email, error, pending, onConnect, onReconnect, onDisconnect, onCancel }) {
  return (
    <div className={`connected-account ${connected ? 'is-connected' : error ? 'error' : ''}`}>
      <div className="connected-account-icon">
        {Icon && <Icon size={22} />}
      </div>
      <div className="connected-account-info">
        <strong>{name}</strong>
        {connected && email && <small>{email}</small>}
        {pending && <small><Loader2 className="spin" size={11} /> Waiting for LinkedIn login…</small>}
        {error && <small className="error-text">{error}</small>}
      </div>
      <div className="connected-account-status">
        {connected ? (
          <>
            <span className="status-badge is-connected"><CheckCircle size={14} /> Connected</span>
            {onDisconnect && (
              <button className="btn-ghost danger sm" onClick={onDisconnect}>Disconnect</button>
            )}
          </>
        ) : pending ? (
          <>
            <span className="status-badge"><Loader2 className="spin" size={14} /> Connecting…</span>
            {onCancel && <button className="btn-ghost sm" onClick={onCancel}>Cancel</button>}
          </>
        ) : error ? (
          <button className="btn-ghost error" onClick={onReconnect}>
            <RefreshCw size={14} /> Reconnect
          </button>
        ) : (
          <button className="btn-accent" onClick={onConnect}>Connect</button>
        )}
      </div>
    </div>
  );
}
