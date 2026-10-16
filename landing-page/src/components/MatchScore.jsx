import React from 'react';
import { User } from 'lucide-react';
import { profileStore } from '../lib/api';

export default function MatchScore({ score = 0, explanation = '', size = 'normal' }) {
  const radius = size === 'small' ? 18 : 28;
  const stroke = size === 'small' ? 3 : 4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const viewSize = (radius + stroke) * 2;

  const profile = profileStore?.get ? profileStore.get() : null;
  const avatarUrl = profile?.avatarUrl;

  const getColor = (s) => {
    if (s >= 80) return '#22a65b';
    if (s >= 60) return '#445cf5';
    if (s >= 40) return '#d4920a';
    return '#c74a3d';
  };

  const color = getColor(score);

  return (
    <div className={`match-score match-score-${size}`}>
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
        <svg width={viewSize} height={viewSize} className="match-score-ring" style={{ position: 'absolute', inset: 0 }}>
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            fill="none"
            stroke="#e8e8e3"
            strokeWidth={stroke}
          />
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
            className="match-score-progress"
          />
        </svg>

        {/* User Profile icon or Avatar centered inside the score circle */}
        <div
          style={{
            width: radius * 1.35,
            height: radius * 1.35,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: avatarUrl ? 'transparent' : '#f4f4f0',
            color: color,
            zIndex: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="User Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <User size={size === 'small' ? 14 : 22} strokeWidth={2.2} style={{ color }} />
          )}
        </div>
      </div>

      <div className="match-score-text">
        <strong style={{ color }}>{score}%</strong>
        {size !== 'small' && <span>Match</span>}
      </div>
      {explanation && size !== 'small' && (
        <p className="match-score-explanation">{explanation}</p>
      )}
    </div>
  );
}

