import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Briefcase, User, FileText, FolderOpen, Mail, LogOut, Menu, HelpCircle, Bell, PlusCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { profileStore, getUserName } from '../lib/api';
import PawLogo from './PawLogo';

const LinkedinIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/dashboard/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/dashboard/applications', icon: FolderOpen, label: 'Job Tracker' },
  { to: '/dashboard/resume', icon: FileText, label: 'Resume' },
  { to: '/dashboard/profile', icon: User, label: 'Profile' },
  { to: '/dashboard/mail', icon: Mail, label: 'Mail' },
  { to: '/dashboard/linkedin', icon: LinkedinIcon, label: 'LinkedIn' },
  { to: '/dashboard/post-jobs', icon: PlusCircle, label: 'Post Jobs' },
];

export default function TopNav({ onMenu }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const name = getUserName(user);
  const initials = name.split(/[\s@.]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // Profile completion percentage calculation
  const [completionPct, setCompletionPct] = useState(40);

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
    navigate('/');
  };

  // SVG Ring measurements (44px container, 19px radius)
  const r = 19;
  const circ = 2 * Math.PI * r;
  const offset = circ - (completionPct / 100) * circ;

  return (
    <header className="topnav">
      <button className="topnav-menu topnav-icon-btn" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      <a className="topnav-brand" href="/dashboard">
        <PawLogo size={30} />
        <span>HAMZO</span>
      </a>

      <nav className="topnav-links">
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `topnav-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="topnav-right">
        <button className="topnav-icon-btn" title="Help" onClick={() => navigate('/dashboard/profile')}>
          <HelpCircle size={19} />
        </button>
        <button className="topnav-icon-btn" title="Notifications">
          <Bell size={19} />
        </button>
        <button className="topnav-icon-btn" title="Sign out" onClick={handleLogout}>
          <LogOut size={18} />
        </button>

        {/* Precise Circular Progress Ring Wrapping User Avatar */}
        <div
          className="profile-avatar-progress-container"
          onClick={() => navigate('/dashboard/profile')}
          title={`Profile Completion: ${completionPct}% — Click to view/edit profile`}
        >
          <svg width="44" height="44" viewBox="0 0 44 44">
            <circle
              cx="22"
              cy="22"
              r={r}
              stroke="#e5e5e0"
              strokeWidth="3"
              fill="none"
            />
            <circle
              cx="22"
              cy="22"
              r={r}
              stroke="#445cf5"
              strokeWidth="3"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              fill="none"
              transform="rotate(-90 22 22)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>

          <div className="avatar-circle-inner">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={name} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
