import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, applicationStore } from '../lib/api';
import './HamzoohAssistant.css';

const SUGGESTIONS = [
  { icon: '💼', text: 'Google employees in my network' },
  { icon: '📩', text: 'Who replied to my emails?' },
  { icon: '📝', text: 'Which companies have I applied to?' },
  { icon: '📄', text: 'Give me my Twilio tailored resume' },
  { icon: '💬', text: "Who didn't reply on LinkedIn?" },
];

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: [
    'Hi! I am your **Hamzooh Copilot**.',
    '',
    'I answer only from your own records — LinkedIn outreach, referral emails, applications, tailored resumes and posted jobs. Nothing is invented.',
    '',
    'Pick a question below or type your own.',
  ].join('\n'),
};

/* A tiny markdown renderer: bold, italics, code, links and bullets. */
function renderInline(text, keyPrefix = 'i') {
  const nodes = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] && match[2]) {
      nodes.push(
        <a key={key} className="hz-link" href={match[2]} target="_blank" rel="noopener noreferrer">
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      nodes.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4]) {
      nodes.push(<code key={key}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<em key={key}>{match[5]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  return (
    <div className="hz-markdown">
      {lines.map((line, index) => {
        const key = `l-${index}`;
        const trimmed = line.trim();
        if (!trimmed) return <div key={key} className="hz-gap" />;
        if (trimmed.startsWith('### ')) return <h5 key={key}>{renderInline(trimmed.slice(4), key)}</h5>;
        if (trimmed.startsWith('## ')) return <h4 key={key}>{renderInline(trimmed.slice(3), key)}</h4>;
        if (trimmed.startsWith('  ↳') || trimmed.startsWith('↳')) {
          return <p key={key} className="hz-quote">{renderInline(trimmed.replace(/^↳\s*/, ''), key)}</p>;
        }
        if (trimmed.startsWith('- ')) {
          return (
            <p key={key} className="hz-bullet">
              <span className="hz-dot" aria-hidden="true">•</span>
              <span>{renderInline(trimmed.slice(2), key)}</span>
            </p>
          );
        }
        return <p key={key}>{renderInline(trimmed, key)}</p>;
      })}
    </div>
  );
}

function ActionChip({ action, onRoute }) {
  const label = action.label || 'Open';
  if (action.type === 'download' && action.url) {
    return (
      <a className="hz-action hz-action-download" href={action.url} download rel="noopener noreferrer">
        <span aria-hidden="true">⬇</span> {label}
      </a>
    );
  }
  if (action.type === 'route' && action.path) {
    return (
      <button type="button" className="hz-action" onClick={() => onRoute(action.path)}>
        <span aria-hidden="true">→</span> {label}
      </button>
    );
  }
  if (action.url) {
    return (
      <a className="hz-action" href={action.url} target="_blank" rel="noopener noreferrer">
        <span aria-hidden="true">↗</span> {label}
      </a>
    );
  }
  return null;
}

export default function HamzoohAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(questionText) {
    const question = String(questionText ?? input).trim();
    if (!question || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: question }]);
    setLoading(true);
    try {
      const history = messages
        .filter((message) => message.id !== 'welcome')
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));
      const data = await apiFetch('', '/api/rag/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: question,
          history,
          // Applications live in this browser, so pass them explicitly.
          clientState: { applications: applicationStore.getAll() },
        }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply || 'I could not find anything for that question.',
          actions: Array.isArray(data.actions) ? data.actions : [],
          model: data.model,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          error: true,
          content: `⚠️ ${error.message || 'Could not reach the copilot.'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function clearChat() {
    setMessages([WELCOME]);
    setInput('');
  }

  function goTo(path) {
    navigate(path);
    setOpen(false);
  }

  return (
    <div className={`hz-assistant${open ? ' is-open' : ''}`}>
      {open && (
        <section className="hz-window" role="dialog" aria-label="Hamzooh AI Assistant">
          <header className="hz-header">
            <div className="hz-avatar" aria-hidden="true">✦</div>
            <div className="hz-heading">
              <strong>Hamzooh AI Assistant</strong>
              <span className="hz-subtitle">
                <i className="hz-online" aria-hidden="true" /> GPT-6 Luna · verified local data
              </span>
            </div>
            <div className="hz-header-actions">
              <button type="button" className="hz-icon-btn" onClick={clearChat} title="Clear chat" aria-label="Clear chat">
                ⟲
              </button>
              <button type="button" className="hz-icon-btn" onClick={() => setOpen(false)} title="Minimize" aria-label="Minimize assistant">
                ✕
              </button>
            </div>
          </header>

          <div className="hz-stream" ref={streamRef}>
            {messages.map((message) => (
              <div key={message.id} className={`hz-msg hz-msg-${message.role}${message.error ? ' is-error' : ''}`}>
                <div className="hz-bubble">
                  <Markdown text={message.content} />
                  {message.actions?.length > 0 && (
                    <div className="hz-actions">
                      {message.actions.map((action, index) => (
                        <ActionChip key={`${message.id}-a-${index}`} action={action} onRoute={goTo} />
                      ))}
                    </div>
                  )}
                  {message.model && (
                    <span className="hz-meta">{message.model === 'gpt-6-luna' ? 'gpt-6-luna' : 'verified records'}</span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="hz-msg hz-msg-assistant">
                <div className="hz-bubble hz-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>

          <div className="hz-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.text}
                type="button"
                className="hz-chip"
                onClick={() => send(suggestion.text)}
                disabled={loading}
              >
                <span aria-hidden="true">{suggestion.icon}</span> {suggestion.text}
              </button>
            ))}
          </div>

          <form
            className="hz-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your network, emails, applications…"
              rows={1}
              aria-label="Message the Hamzooh assistant"
            />
            <button type="submit" className="hz-send" disabled={loading || !input.trim()} aria-label="Send message">
              ↑
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="hz-fab"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close Hamzooh Copilot' : 'Ask Hamzooh Copilot'}
        title={open ? 'Close Hamzooh Copilot' : 'Ask Hamzooh Copilot'}
      >
        {open ? '✕' : '✦'}
        <span className="hz-fab-ring" aria-hidden="true" />
      </button>
    </div>
  );
}
