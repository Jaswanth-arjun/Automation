import React from 'react';

export default function MatchScore({ score = 0, explanation = '', size = 'normal' }) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const isSmall = size === 'small';

  const radius = isSmall ? 15 : 24;
  const stroke = isSmall ? 3.5 : 4.5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeScore / 100) * circumference;
  const viewSize = isSmall ? 42 : 58;
  const center = viewSize / 2;

  const isHigh = safeScore >= 70;
  const color = isHigh ? '#16a34a' : safeScore >= 40 ? '#ea580c' : '#f97316';
  const track = isHigh ? '#dcfce7' : '#ffedd5';

  return (
    <div
      className={`match-score match-score-${size}`}
      title={`${safeScore}% match score`}
      style={{
        display: 'inline-flex',
        flexDirection: isSmall ? 'row' : 'column',
        alignItems: isSmall ? 'center' : 'flex-start',
        gap: isSmall ? '0' : '8px',
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
        <svg
          width={viewSize}
          height={viewSize}
          style={{ transform: 'rotate(-90deg)', display: 'block' }}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={track}
            strokeWidth={stroke}
          />
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
            color: color,
            userSelect: 'none',
            lineHeight: 1,
          }}
        >
          {safeScore}%
        </span>
      </div>

      {!isSmall && (
        <div className="match-score-text">
          <strong style={{ color }}>{safeScore}% Match</strong>
          {explanation && (
            <p className="match-score-explanation" style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280', lineHeight: '1.4' }}>
              {explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

