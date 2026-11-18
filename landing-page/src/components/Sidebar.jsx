import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Bookmark,
  User,
  FileText,
  FolderOpen,
  Mail,
  PlusCircle,
  HelpCircle,
  Bell,
  LogOut,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { profileStore, getUserName } from '../lib/api';
import { useConnectStatus } from '../lib/connectStatus';
import PawLogo from './PawLogo';

const LinkedinIcon = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const navSections = [
  {
    title: 'MENU',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
      { to: '/dashboard/jobs', icon: Briefcase, label: 'Jobs' },
      { to: '/dashboard/saved', icon: Bookmark, label: 'Saved Jobs' },
      { to: '/dashboard/applications', icon: FolderOpen, label: 'Job Tracker' },
      { to: '/dashboard/resume', icon: FileText, label: 'Resume' },
      { to: '/dashboard/profile', icon: User, label: 'Profile' },
    ],
  },
  {
    title: 'AUTOMATION',
    items: [
      { to: '/dashboard/mail', icon: Mail, label: 'Mail', health: 'mail' },
      { to: '/dashboard/linkedin', icon: LinkedinIcon, label: 'LinkedIn', health: 'linkedin' },
    ],
  },
  {
    title: 'RECRUITER',
    items: [
      { to: '/dashboard/post-jobs', icon: PlusCircle, label: 'Post Jobs' },
    ],
  },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const name = getUserName(user);
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U';

  const [completionPct, setCompletionPct] = useState(40);
  const { mail: mailHealth, linkedin: liHealth, error: healthError } = useConnectStatus(user?.id);

  const healthOf = (key) => {
    if (healthError) return null;
    const channel = key === 'mail' ? mailHealth : liHealth;
    if (!channel) return null;
    if (channel.state === 'connected') {
      return { tone: 'is-on', label: `${key === 'mail' ? 'Gmail' : 'LinkedIn'} connected` };
    }
    if (channel.state === 'expired' || channel.state === 'pending') {
      return { tone: 'is-warn', label: `${key === 'mail' ? 'Gmail' : 'LinkedIn'} needs a re-login` };
    }
    return { tone: 'is-off', label: `Connect ${key === 'mail' ? 'Gmail' : 'LinkedIn'} to use this` };
  };

  useEffect(() => {
    const calculatePct = () => {
      try {
        const saved = profileStore.get();
        if (!saved) {
          setCompletionPct(30);
          return;
        }

        let score = 0;
        if (saved.fullName?.trim()) score += 15;
        if (saved.email?.trim()) score += 15;
        if (saved.phone?.trim()) score += 10;
        if (saved.location?.trim()) score += 10;
        if (saved.resume?.dataUrl || saved.resume?.fileName) score += 20;
        if (saved.skills && saved.skills.length > 0) score += 10;
        if (saved.education && saved.education.length > 0) score += 10;
        if (
          (saved.experience && saved.experience.length > 0) ||
          (saved.projects && saved.projects.length > 0) ||
          saved.links?.github ||
          saved.links?.linkedin
        ) {
          score += 10;
        }
        setCompletionPct(Math.min(100, Math.max(0, score)));
      } catch {
        setCompletionPct(40);
      }
    };

    calculatePct();
    window.addEventListener('storage', calculatePct);
    window.addEventListener('profile_updated', calculatePct);
    return () => {
      window.removeEventListener('storage', calculatePct);
      window.removeEventListener('profile_updated', calculatePct);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  // 40px container, 17px radius
  const r = 17;
  const circ = 2 * Math.PI * r;
  const offset = circ - (completionPct / 100) * circ;

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        {/* Sidebar Header Brand */}
        <div className="sidebar-header">
          <NavLink to="/dashboard" className="sidebar-brand" onClick={onClose}>
            <span className="sidebar-brand-mark"><PawLogo size={26} /></span>
            <span className="sidebar-brand-text">HAMZO</span>
          </NavLink>
          <button className="sidebar-close" onClick={onClose} aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>

        {/* Sidebar Navigation */}
        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.title} className="sidebar-section">
              <div className="sidebar-section-label">{section.title}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const health = item.health ? healthOf(item.health) : null;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? 'active' : ''}`
                    }
                    onClick={onClose}
                  >
                    <Icon size={19} />
                    <span>{item.label}</span>
                    {health && (
                      <span
                        className={`sidebar-health ${health.tone}`}
                        title={health.label}
                        aria-label={health.label}
                        role="img"
                      />
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer: User Card + Utility Actions */}
        <div className="sidebar-footer">
          <div
            className="sidebar-user-card"
            onClick={() => {
              navigate('/dashboard/profile');
              onClose?.();
            }}
            title={`Profile Completion: ${completionPct}% — Click to view profile`}
          >
            <div className="sidebar-avatar-ring-wrap">
              <svg width="40" height="40" viewBox="0 0 40 40">
                <circle
                  cx="20"
                  cy="20"
                  r={r}
                  stroke="#e8e8e3"
                  strokeWidth="2.5"
                  fill="none"
                />
                <circle
                  cx="20"
                  cy="20"
                  r={r}
                  stroke="#445cf5"
                  strokeWidth="2.5"
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  fill="none"
                  transform="rotate(-90 20 20)"
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                />
              </svg>
              <div className="sidebar-avatar-inner">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={name} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>

            <div className="sidebar-user-details">
              <strong className="sidebar-user-name">{name}</strong>
              <small className="sidebar-user-pct">{completionPct}% completed</small>
            </div>
          </div>

          <div className="sidebar-actions-row">
            <button
              className="sidebar-action-btn"
              title="Help & FAQ"
              onClick={() => {
                navigate('/dashboard/profile');
                onClose?.();
              }}
            >
              <HelpCircle size={16} />
              <span>Help</span>
            </button>
            <button
              className="sidebar-action-btn"
              title="Notifications"
            >
              <Bell size={16} />
              <span>Alerts</span>
            </button>
            <button
              className="sidebar-action-btn sidebar-logout-btn"
              title="Sign out"
              onClick={handleLogout}
            >
              <LogOut size={15} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
