import React, { useState, useEffect } from 'react';

export default function StatsCard({ icon: Icon, label, value, color = 'var(--accent)' }) {
  const [display, setDisplay] = useState(0);
  const numValue = typeof value === 'number' ? value : parseInt(value) || 0;

  useEffect(() => {
    if (numValue === 0) { setDisplay(0); return; }
    let start = 0;
    const dur = 800;
    const step = dur / numValue;
    const timer = setInterval(() => {
      start++;
      setDisplay(start);
      if (start >= numValue) clearInterval(timer);
    }, Math.max(step, 16));
    return () => clearInterval(timer);
  }, [numValue]);

  return (
    <div className="stats-card">
      <div className="stats-card-icon" style={{ color, background: `${color}14` }}>
        {Icon && <Icon size={20} />}
      </div>
      <div className="stats-card-body">
        <span className="stats-card-value">{typeof value === 'number' ? display : value}</span>
        <span className="stats-card-label">{label}</span>
      </div>
    </div>
  );
}
