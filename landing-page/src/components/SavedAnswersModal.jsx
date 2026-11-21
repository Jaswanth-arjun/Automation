import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * User-facing answer memory.
 *
 * Answers are scoped to the signed-in account. Sensitive categories require an
 * explicit consent checkbox and are encrypted at rest by the backend. Editing
 * an answer updates future applications; deleting it prevents future reuse.
 */

export default function SavedAnswersModal({ open, onClose }) {
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError('');
    api.listAnswerMemory()
      .then((res) => { if (alive) setAnswers(res.answers || []); })
      .catch((err) => { if (alive) setError(err.message || 'Could not load saved answers.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const addAnswer = async () => {
    if (!question.trim() || !answer.trim()) return;
    setBusy('add');
    setError('');
    try {
      const res = await api.saveAnswerMemory({ question: question.trim(), answer: answer.trim(), consent });
      setAnswers((previous) => [res.answer, ...previous.filter((entry) => entry.id !== res.answer.id)]);
      setQuestion('');
      setAnswer('');
      setConsent(false);
    } catch (err) {
      setError(err.message || 'Could not save that answer.');
    } finally {
      setBusy('');
    }
  };

  const saveEdit = async (entry) => {
    const value = editing[entry.id] ?? entry.answer;
    if (!String(value).trim()) return;
    setBusy(entry.id);
    setError('');
    try {
      const res = await api.updateAnswerMemory(entry.id, { answer: value });
      setAnswers((previous) => previous.map((item) => (item.id === entry.id ? res.answer : item)));
      setEditing((previous) => {
        const next = { ...previous };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setError(err.message || 'Could not update that answer.');
    } finally {
      setBusy('');
    }
  };

  const removeAnswer = async (entry) => {
    if (!window.confirm('Delete this saved answer? Future applications will ask you again.')) return;
    setBusy(entry.id);
    setError('');
    try {
      await api.deleteAnswerMemory(entry.id);
      setAnswers((previous) => previous.filter((item) => item.id !== entry.id));
    } catch (err) {
      setError(err.message || 'Could not delete that answer.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '18px', width: '100%', maxWidth: '620px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '18px 22px', background: '#171817', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800 }}>Saved answers</div>
            <div style={{ fontSize: '11.5px', opacity: 0.75 }}>Reused only when the question is genuinely compatible.</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '9px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto' }}>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', marginBottom: '16px', background: '#f8fafc' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>Add an answer</div>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Question, e.g. Are you authorized to work in the US?"
              style={{ width: '100%', padding: '9px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' }}
            />
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Answer"
              rows={2}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical' }}
            />
            <label style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginTop: '8px', fontSize: '11.5px', color: '#475569' }}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} style={{ marginTop: '2px' }} />
              I consent to saving this answer. Sensitive personal/legal answers are encrypted at rest and never shared across accounts.
            </label>
            <button
              type="button"
              onClick={addAnswer}
              disabled={busy === 'add' || !question.trim() || !answer.trim()}
              style={{ marginTop: '9px', padding: '9px 16px', borderRadius: '9px', border: 'none', background: question.trim() && answer.trim() ? '#0d9488' : '#94a3b8', color: '#fff', fontWeight: 700, fontSize: '12.5px', cursor: question.trim() && answer.trim() ? 'pointer' : 'not-allowed' }}
            >
              {busy === 'add' ? 'Saving…' : 'Save answer'}
            </button>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', marginBottom: '12px' }}>
              {error}
            </div>
          )}
          {loading && <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12.5px', padding: '16px' }}>Loading saved answers…</div>}
          {!loading && answers.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12.5px', padding: '16px' }}>
              No saved answers yet. Hamzooh asks you once, then reuses the answer when the same question appears.
            </div>
          )}

          {answers.map((entry) => (
            <div key={entry.id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1f2937', flex: 1, minWidth: '220px' }}>{entry.question}</div>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {entry.sensitive && (
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#9a3412', background: '#ffedd5', borderRadius: '20px', padding: '3px 8px' }}>SENSITIVE</span>
                  )}
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#475569', background: '#f1f5f9', borderRadius: '20px', padding: '3px 8px' }}>
                    {(entry.category || 'general').replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              {editing[entry.id] !== undefined ? (
                <textarea
                  value={editing[entry.id]}
                  onChange={(event) => setEditing((previous) => ({ ...previous, [entry.id]: event.target.value }))}
                  rows={2}
                  style={{ width: '100%', marginTop: '8px', padding: '9px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical' }}
                />
              ) : (
                <div style={{ marginTop: '7px', fontSize: '12.5px', color: '#334155', whiteSpace: 'pre-wrap' }}>{entry.answer}</div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '9px', flexWrap: 'wrap' }}>
                {editing[entry.id] !== undefined ? (
                  <>
                    <button type="button" onClick={() => saveEdit(entry)} disabled={busy === entry.id} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#0d9488', color: '#fff', fontWeight: 700, fontSize: '11.5px', cursor: 'pointer' }}>
                      {busy === entry.id ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => setEditing((previous) => { const next = { ...previous }; delete next[entry.id]; return next; })} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 700, fontSize: '11.5px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditing((previous) => ({ ...previous, [entry.id]: entry.answer }))} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 700, fontSize: '11.5px', cursor: 'pointer' }}>
                    Edit
                  </button>
                )}
                <button type="button" onClick={() => removeAnswer(entry)} disabled={busy === entry.id} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '11.5px', cursor: 'pointer' }}>
                  Delete
                </button>
                <span style={{ fontSize: '10.5px', color: '#94a3b8', alignSelf: 'center' }}>
                  {entry.source ? `${entry.source} · ` : ''}{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
