import React from 'react';

export function CardSkeleton({ count = 3 }) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-line w60" />
          <div className="skeleton-line w40" />
          <div className="skeleton-line w80" />
          <div className="skeleton-line w30" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-circle" />
          <div className="skeleton-lines">
            <div className="skeleton-line w60" />
            <div className="skeleton-line w40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="skeleton-profile">
      <div className="skeleton-avatar-lg" />
      <div className="skeleton-line w40" />
      <div className="skeleton-line w60" />
      <div className="skeleton-line w80" />
      <div className="skeleton-line w50" />
    </div>
  );
}
