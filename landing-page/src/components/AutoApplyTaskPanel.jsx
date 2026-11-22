import React from 'react';

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

const STATUS_LABELS = {
  initializing: 'Initializing',
  connecting_browser: 'Connecting to your browser',
  analyzing_job: 'Analyzing job and resume',
  preparing_application: 'Preparing the application',
  filling_application: 'Filling the application',
  waiting_for_user_input: 'Waiting for your answer',
  waiting_for_approval: 'Ready for your approval',
  submitting: 'Submitting approved application',
  submitted: 'Submitted and verified',
  paused: 'Paused',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS = {
  submitted: '#059669',
  waiting_for_approval: '#0d9488',
  waiting_for_user_input: '#d97706',
  paused: '#d97706',
  failed: '#dc2626',
  cancelled: '#6b7280',
};

function statusColor(status) {
  return STATUS_COLORS[status] || '#171817';
}

function formatTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
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

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        flexWrap: 'wrap', padding: '12px 14px', borderRadius: '12px',
        background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: statusColor(status), boxShadow: `0 0 0 4px ${statusColor(status)}22`,
          }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
              {STATUS_LABELS[status] || status}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
              {task.job?.title || 'Application'}{task.job?.company ? ` · ${task.job.company}` : ''}
            </div>
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600, textAlign: 'right' }}>
          {usage.calls || 0} AI call{Number(usage.calls) === 1 ? '' : 's'} · {money(usage.costUsd)}
          {task.agent?.lastAction?.model && (
            <div style={{ fontWeight: 500, color: '#94a3b8', marginTop: '2px' }}>
              {task.agent.lastAction.model} · {task.agent.lastAction.role || 'primary'}{Number(usage.escalations) > 0 ? ` · ${usage.escalations} escalation${Number(usage.escalations) === 1 ? '' : 's'}` : ''}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {task.selectedResume?.name && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', fontSize: '12px', color: '#166534', marginBottom: '12px' }}>
          <span><strong>Resume:</strong> {task.selectedResume.name}</span>
          <span>{task.selectedResume.reasoning || 'Selected for this job.'}</span>
        </div>
      )}

      {pendingQuestions.length > 0 && (
        <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#92400e', marginBottom: '4px' }}>
            Additional information required
          </div>
          <div style={{ fontSize: '11.5px', color: '#a16207', marginBottom: '10px' }}>
            The agent will not guess personal or legal facts. Answer here and it continues from its checkpoint.
          </div>
          {pendingQuestions.map((question) => {
            const draft = answerDrafts[question.id] ?? '';
            const sensitive = question.sensitive || /authori[sz]ed|sponsor|visa|salary|disab|criminal|gender|race|veteran|age|ssn|passport/i.test(question.question);
            return (
              <div key={question.id} style={{ background: '#fff', borderRadius: '10px', padding: '12px', border: '1px solid #fde68a', marginBottom: '10px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1f2937', lineHeight: 1.45 }}>
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
        <div style={{ border: '1px solid #a7f3d0', background: '#f0fdf4', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#065f46', marginBottom: '8px' }}>
            Application review
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: '12px', color: '#064e3b' }}>
            <span><strong>Company:</strong> {task.review.company || task.job?.company || '—'}</span>
            <span><strong>Role:</strong> {task.review.title || task.job?.title || '—'}</span>
            <span><strong>Resume:</strong> {task.review.resumeName || task.selectedResume?.name || '—'}</span>
            <span><strong>Fields filled:</strong> {task.review.filledCount || 0}</span>
          </div>
          {task.review.url && (
            <div style={{ fontSize: '11.5px', color: '#047857', marginTop: '6px', wordBreak: 'break-all' }}>
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
            style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
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
            style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}
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

      <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
        Activity
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', maxHeight: '240px', overflowY: 'auto' }}>
        {(task.steps || []).slice(-14).reverse().map((step, index) => (
          <div key={`${step.at}-${index}`} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', padding: '8px 11px', borderRadius: '9px', background: index === 0 ? '#f0fdf4' : '#f8fafc', border: `1px solid ${index === 0 ? '#bbf7d0' : '#e5e7eb'}` }}>
            <span style={{ fontSize: '12px' }}>{step.level === 'error' ? '❌' : step.level === 'warn' ? '⚠️' : '•'}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: '#1f2937', fontWeight: 600, lineHeight: 1.4 }}>{step.message}</div>
              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '2px' }}>
                {formatTime(step.at)}{step.step ? ` · ${step.step}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '12px', fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span>AI calls: {usage.calls || 0}</span>
        <span>Tokens: {(Number(usage.inputTokens || 0) + Number(usage.outputTokens || 0)).toLocaleString()}</span>
        <span>Cost: {money(usage.costUsd)}</span>
        {limits.maxCostUsd ? <span>Budget: {money(limits.maxCostUsd)}</span> : null}
      </div>
    </div>
  );
}
