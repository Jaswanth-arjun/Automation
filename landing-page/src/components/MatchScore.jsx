import React from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import './JobMatch.css';

/**
 * MatchScore — renders a real, personalised match score.
 *
 * When there is not enough profile/resume evidence to calculate one, it shows
 * the "Complete Your Profile to Calculate Match Score" call to action instead
 * of inventing a percentage.
 */
export default function MatchScore({
  score = null,
  status = 'scored',
  explanation = '',
  size = 'normal',
  missingLabels = [],
  eligibilityReasons = [],
  onComplete,
}) {
  const isSmall = size === 'small';
  const viewSize = isSmall ? 42 : 58;
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const incomplete = status === 'incomplete' || !hasScore;

  /* ---------------- no evidence yet ---------------- */
  if (incomplete) {
    if (isSmall) {
      return (
        <div
          className="score-circle-badge is-empty"
          title="Complete Your Profile to Calculate Match Score"
          style={{
            width: viewSize,
            height: viewSize,
            borderRadius: '50%',
            border: '2px dashed #d8d5cc',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a8a29a',
            fontSize: 11,
            fontWeight: 800,
            flexShrink: 0,
            background: '#faf9f6',
          }}
        >
          —
        </div>
      );
    }
    return (
      <div
        className="match-score is-incomplete"
        title="Complete Your Profile to Calculate Match Score"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 6,
        }}
      >
        <div
          className="match-score-empty-ring"
          style={{ width: viewSize, height: viewSize, fontSize: 14, fontWeight: 800 }}
        >
          —
        </div>
        <strong className="match-score-locked">Complete Your Profile to Calculate Match Score</strong>
        {missingLabels.length > 0 && (
          <ul className="match-score-missing">
            {missingLabels.slice(0, 5).map((label) => (
              <li key={label}><AlertCircle size={11} /> {label}</li>
            ))}
          </ul>
        )}
        {onComplete && (
          <button type="button" className="match-score-cta" onClick={onComplete}>
            Complete your profile
          </button>
        )}
      </div>
    );
  }

  /* ---------------- scored ---------------- */
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const ineligible = status === 'ineligible';
  const radius = isSmall ? 15 : 24;
  const stroke = isSmall ? 3.5 : 4.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeScore / 100) * circumference;
  const center = viewSize / 2;

  const isHigh = safeScore >= 70;
  const color = ineligible ? '#b91c1c' : isHigh ? '#16a34a' : safeScore >= 40 ? '#ea580c' : '#f97316';
  const track = ineligible ? '#fee2e2' : isHigh ? '#dcfce7' : '#ffedd5';

  if (isSmall) {
    return (
      <div
        className="score-circle-badge"
        title={`${safeScore}% match score${ineligible ? ' — not eligible' : ''}`}
        style={{
          position: 'relative',
          width: viewSize,
          height: viewSize,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width={viewSize} height={viewSize} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        </svg>
        <span
          style={{
            position: 'absolute',
            fontSize: '11px',
            fontWeight: '800',
            letterSpacing: '-0.02em',
            color,
            lineHeight: 1,
          }}
        >
          {safeScore}%
        </span>
      </div>
    );
  }

  return (
    <div
      className={`match-score match-score-${size}`}
      title={`${safeScore}% match score${ineligible ? ' — not eligible' : ''}`}
      style={{
        display: 'inline-flex',
        flexDirection: isSmall ? 'row' : 'column',
        alignItems: isSmall ? 'center' : 'flex-start',
        gap: isSmall ? '6px' : '8px',
      }}
    >
      <div
        className="match-score-circle-wrapper"
        style={{
          position: 'relative',
          width: viewSize,
          height: viewSize,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width={viewSize} height={viewSize} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={center} cy={center} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        </svg>

        <span
          style={{
            position: 'absolute',
            fontSize: isSmall ? '11px' : '14px',
            fontWeight: '800',
            letterSpacing: '-0.02em',
            color,
            userSelect: 'none',
            lineHeight: 1,
          }}
        >
          {safeScore}%
        </span>
      </div>

      {isSmall && ineligible && (
        <span className="match-score-flag" title={(eligibilityReasons[0] || 'Mandatory requirements not met')}>
          <ShieldAlert size={11} /> Not eligible
        </span>
      )}

      {!isSmall && (
        <div className="match-score-text">
          <strong style={{ color }}>{safeScore}% Match</strong>
          {ineligible && (
            <span className="match-score-sub">Skills match · not eligible</span>
          )}
          {explanation && (
            <p className="match-score-explanation" style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280', lineHeight: '1.4' }}>
              {explanation}
            </p>
          )}
          {ineligible && eligibilityReasons.length > 0 && (
            <div className="match-score-eligibility">
              <ShieldAlert size={13} />
              <div>
                <strong>Not eligible for this role</strong>
                {eligibilityReasons.slice(0, 3).map((reason) => <p key={reason}>{reason}</p>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
