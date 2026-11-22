import React from 'react';
import { FileText } from 'lucide-react';
import { automationPhases, automationNow, buildActivityFeed, relativeTime } from '../lib/autoApplyNarrative';

/**
 * Live state for an autonomous application task.
 *
 * Every value shown here comes from the backend task record — nothing is
 * simulated. Approval and cancellation call the backend; the extension polls
 * the same task record before it touches the submit control.
 */

const ACTIVE_STATUSES = new Set([
  'initializing', 'connecting_browser', 'analyzing_job', 'preparing_application',
  'filling_application', 'submitting',
]);

const TONES = {
  error: { fg: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  warn: { fg: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  success: { fg: '#047857', bg: '#ecfdf5', border: '#bbf7d0' },
  info: { fg: '#1d4ed8', bg: '#eff6ff', border: '#dbeafe' },
};

function nowTone(tone) {
  return TONES[tone] || TONES.info;
}

function money(value) {
  const number = Number(value || 0);
  if (!number) return '$0.0000';
  return `$${number.toFixed(number < 0.01 ? 4 : 2)}`;
}

export default function AutoApplyTaskPanel({
  task,
  busy = '',
  error = '',
  answerDrafts = {},
  answerConsent = {},
  onDraftChange,
  onConsentChange,
  onAnswer,
  onApprove,
  onCancel,
  onPause,
  onResume,
  onMarkSubmitted,
}) {
  if (!task) return null;

  const status = task.status || 'initializing';
  const now = automationNow(task);
  const tone = nowTone(now.tone);
  const running = ACTIVE_STATUSES.has(status);
  const usage = task.usage || {};
  const limits = usage.limits || task.limits || {};
  const pendingQuestions = (task.questions || []).filter((question) => question.status === 'pending');
  const subtractMissing = task.review?.missing || [];
  const isTerminal = ['submitted', 'failed', 'cancelled'].includes(status);
  const approved = task.approval?.status === 'approved';
  const canApprove = status === 'waiting_for_approval'
    && !approved
    && pendingQuestions.length === 0
    && subtractMissing.length === 0;

  const phases = automationPhases(status);
  const activeIndex = Math.max(0, phases.findIndex((phase) => phase.state === 'active'));
  const currentPhase = phases[activeIndex] || phases[phases.length - 1] || { title: '' };
  const tokens = Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0);

  return (
    <div>
      {/* Where the run is inside the five stages */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '4px', flex: 1, minWidth: 0 }}>
          {phases.map((phase) => (
            <span
              key={phase.id}
              style={{
                flex: 1, height: '5px', borderRadius: '999px',
                background: phase.state === 'done' ? '#10b981' : phase.state === 'active' ? '#86efac' : '#ecece7',
              }}
            />
          ))}
        </div>
        <span
          title={currentPhase.title}
          style={{
            fontSize: '10.5px', fontWeight: '700', color: '#8a8f88', whiteSpace: 'nowrap',
            maxWidth: '52%', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          Step {activeIndex + 1}/{phases.length} · {currentPhase.title}
        </span>
      </div>

      {/* What the automation is doing right now */}
      <div style={{
        display: 'flex', gap: '13px', alignItems: 'stretch',
        padding: '14px 16px', borderRadius: '14px', background: '#ffffff',
        border: `1px solid ${tone.border}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        marginBottom: '12px',
      }}>
        <span style={{ width: '4px', borderRadius: '999px', flexShrink: 0, background: tone.fg, opacity: 0.9 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {running && (
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', background: tone.fg,
                animation: 'pulseDot 1.4s ease-in-out infinite', flexShrink: 0,
              }} />
            )}
            <div style={{ fontSize: '13.5px', fontWeight: '800', color: '#171817', lineHeight: 1.35 }}>{now.title}</div>
          </div>
          {now.detail && (
            <div style={{ fontSize: '12px', color: '#5b6470', marginTop: '3px', lineHeight: 1.55 }}>{now.detail}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '9px', fontSize: '10.5px', color: '#9aa0a6' }}>
            <span>{usage.calls || 0} AI call{Number(usage.calls) === 1 ? '' : 's'}</span>
            <span>{money(usage.costUsd)}</span>
            {tokens > 0 && <span>{tokens.toLocaleString()} tokens</span>}
            {limits.maxCostUsd ? <span>budget {money(limits.maxCostUsd)}</span> : null}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex', gap: '9px', alignItems: 'flex-start',
          background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: '10px', padding: '10px 13px', fontSize: '12px', lineHeight: 1.5, marginBottom: '12px',
        }}>
          <span style={{
            width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, marginTop: '1px',
            background: '#fee2e2', color: '#b91c1c', fontSize: '11px', fontWeight: '800',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>!</span>
          <span>{error}</span>
        </div>
      )}

      {task.selectedResume?.name && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap',
          padding: '9px 12px', background: '#fafaf7', border: '1px solid #ecece7',
          borderRadius: '10px', fontSize: '11.5px', color: '#5b6470', marginBottom: '12px',
        }}>
          <FileText size={13} style={{ color: '#059669', flexShrink: 0 }} />
          <span style={{ fontWeight: '700', color: '#171817', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.selectedResume.name}
          </span>
          <span style={{ color: '#9aa0a6' }}>·</span>
          <span>{task.selectedResume.reasoning || 'Selected for this application'}</span>
        </div>
      )}

      {pendingQuestions.length > 0 && (
        <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '14px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: '800', color: '#92400e', marginBottom: '4px' }}>
            Additional information required
          </div>
          <div style={{ fontSize: '11.5px', color: '#a16207', marginBottom: '10px', lineHeight: 1.5 }}>
            The agent will not guess personal or legal facts. Answer here and it continues from its checkpoint.
          </div>
          {pendingQuestions.map((question) => {
            const draft = answerDrafts[question.id] ?? '';
            const sensitive = question.sensitive || /authori[sz]ed|sponsor|visa|salary|disab|criminal|gender|race|veteran|age|ssn|passport/i.test(question.question);
            return (
              <div key={question.id} style={{ background: '#fff', borderRadius: '10px', padding: '12px', border: '1px solid #fde68a', marginBottom: '10px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: '700', color: '#1f2937', lineHeight: 1.45 }}>
                  {question.question}
                </div>
                {Array.isArray(question.options) && question.options.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => onDraftChange?.(question.id, option)}
                        style={{
                          padding: '6px 10px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                          border: draft === option ? '1.5px solid #0d9488' : '1px solid #cbd5e1',
                          background: draft === option ? '#ccfbf1' : '#f8fafc', color: '#0f172a',
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => onDraftChange?.(question.id, event.target.value)}
                  placeholder="Your answer…"
                  rows={sensitive || question.options?.length === 0 ? 2 : 1}
                  style={{ width: '100%', marginTop: '8px', padding: '9px 12px', borderRadius: '9px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical' }}
                />
                <label style={{ display: 'flex', gap: '7px', alignItems: 'center', marginTop: '8px', fontSize: '11.5px', color: '#475569' }}>
                  <input
                    type="checkbox"
                    checked={sensitive ? answerConsent[question.id] === true : answerConsent[question.id] !== false}
                    onChange={(event) => onConsentChange?.(question.id, event.target.checked)}
                  />
                  Save this answer for future applications
                  {sensitive ? ' (explicit consent required for sensitive facts)' : ''}
                </label>
                <button
                  type="button"
                  disabled={busy === `answer:${question.id}` || !String(draft).trim()}
                  onClick={() => onAnswer?.(question)}
                  style={{
                    marginTop: '9px', padding: '9px 16px', borderRadius: '9px', border: 'none',
                    background: String(draft).trim() ? '#0d9488' : '#94a3b8', color: '#fff',
                    fontWeight: 700, fontSize: '12.5px', cursor: String(draft).trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {busy === `answer:${question.id}` ? 'Saving…' : 'Save answer & continue'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {task.review && (
        <div style={{ border: '1px solid #d7f0e3', background: '#f7fdfa', borderRadius: '14px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: '800', color: '#065f46', marginBottom: '10px' }}>
            Application review
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 16px', fontSize: '12px', color: '#065f46' }}>
            <span><strong style={{ color: '#86a99b', fontWeight: 700 }}>Company</strong><div style={{ fontWeight: 700 }}>{task.review.company || task.job?.company || '—'}</div></span>
            <span><strong style={{ color: '#86a99b', fontWeight: 700 }}>Role</strong><div style={{ fontWeight: 700 }}>{task.review.title || task.job?.title || '—'}</div></span>
            <span><strong style={{ color: '#86a99b', fontWeight: 700 }}>Resume</strong><div style={{ fontWeight: 700 }}>{task.review.resumeName || task.selectedResume?.name || '—'}</div></span>
            <span><strong style={{ color: '#86a99b', fontWeight: 700 }}>Fields filled</strong><div style={{ fontWeight: 700 }}>{task.review.filledCount || 0}</div></span>
          </div>
          {task.review.url && (
            <div style={{ fontSize: '11px', color: '#0f766e', marginTop: '8px', wordBreak: 'break-all' }}>
              {task.review.url}
            </div>
          )}
          {task.review.missing?.length > 0 && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#9a3412' }}>
              <strong>Missing required information:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {task.review.missing.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}
          {task.review.warnings?.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#a16207' }}>
              {task.review.warnings.slice(0, 5).map((item, index) => <div key={index}>⚠ {item}</div>)}
            </div>
          )}
          {Array.isArray(task.review.answers) && task.review.answers.length > 0 && (
            <div style={{ marginTop: '10px', fontSize: '11.5px', color: '#065f46' }}>
              <strong>Answers used:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {task.review.answers.slice(0, 8).map((item, index) => (
                  <li key={index}><strong>{item.question}:</strong> {item.answer}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {canApprove && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onApprove}
            style={{ padding: '11px 20px', borderRadius: '10px', border: 'none', background: '#059669', color: '#fff', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve & Submit'}
          </button>
        )}
        {approved && !isTerminal && (
          <div style={{ fontSize: '12px', color: '#065f46', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px 14px', borderRadius: '10px', flexBasis: '100%' }}>
            Submission approved. Waiting for the job tab to submit and confirm — reopen it if you closed it.
          </div>
        )}
        {!isTerminal && status !== 'paused' && ACTIVE_STATUSES.has(status) && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onPause}
            style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid #e2e6e1', background: '#fff', color: '#3f463f', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
          >
            {busy === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
        )}
        {(status === 'paused' || (status === 'waiting_for_user_input' && pendingQuestions.length === 0)) && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onResume}
            style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: '#0d9488', color: '#fff', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
          >
            {busy === 'resume' ? 'Resuming…' : status === 'paused' ? 'Resume' : 'Resume agent'}
          </button>
        )}
        {!isTerminal && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onMarkSubmitted}
            style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: '#059669', color: '#fff', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
          >
            {busy === 'mark-submitted' ? 'Marking as Submitted…' : '✅ I Submitted (Mark as Applied)'}
          </button>
        )}
        {!isTerminal && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onCancel}
            style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel Application'}
          </button>
        )}
      </div>

      {status === 'waiting_for_approval' && !canApprove && !approved && (
        <div style={{ fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '10px 14px', borderRadius: '10px', marginBottom: '12px' }}>
          Resolve the missing information above before approving. Hamzooh will not submit an incomplete application.
        </div>
      )}

      <AutoApplyActivityFeed steps={task.steps || []} />
    </div>
  );
}

/**
 * Plain-English activity timeline shared by the task panel and the run popup.
 * Internal steps are dropped by the narrative helpers, so this never reads like
 * a terminal log.
 */
export function AutoApplyActivityFeed({ steps = [], limit = 8, emptyText = 'The first step appears as soon as the application tab opens.' }) {
  const feed = buildActivityFeed(steps, limit);
  return (
    <div style={{ border: '1px solid #efefea', borderRadius: '14px', background: '#ffffff', padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '11px' }}>
        <span style={{ fontSize: '10px', fontWeight: '800', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9aa0a6' }}>
          What it has done
        </span>
        {feed.length > 0 && (
          <span style={{ fontSize: '10px', color: '#b0b5ba' }}>{feed.length} update{feed.length === 1 ? '' : 's'}</span>
        )}
      </div>
      <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
        {feed.length === 0 && (
          <div style={{ fontSize: '11.5px', color: '#9aa0a6', lineHeight: 1.5 }}>{emptyText}</div>
        )}
        {feed.map((item, index) => {
          const dot = item.tone === 'error' ? '#dc2626'
            : item.tone === 'warn' ? '#d97706'
              : item.tone === 'success' ? '#059669'
                : '#94a3b8';
          const isLatest = index === 0;
          const isLast = index === feed.length - 1;
          return (
            <div key={`${item.key}-${index}`} style={{ display: 'flex', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '8px', flexShrink: 0 }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%', marginTop: '6px', background: dot,
                  boxShadow: isLatest ? `0 0 0 3px ${dot}22` : undefined,
                }} />
                {!isLast && <span style={{ flex: 1, width: '1.5px', background: '#efefea', marginTop: '4px' }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1, paddingBottom: isLast ? 0 : '13px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: '12.5px', lineHeight: 1.45,
                    fontWeight: isLatest ? 800 : 600,
                    color: isLatest ? '#171817' : '#4b544c',
                  }}>
                    {item.title}
                  </span>
                  {item.at && (
                    <span style={{ fontSize: '10px', color: '#b0b5ba', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {relativeTime(item.at)}
                    </span>
                  )}
                </div>
                {item.detail && (
                  <div style={{ fontSize: '11.5px', color: '#8a8f88', marginTop: '2px', lineHeight: 1.5 }}>{item.detail}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
