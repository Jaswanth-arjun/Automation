import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Briefcase, User, FileText, FolderOpen, Mail, LogOut, X, Share2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { profileStore, getUserName } from '../lib/api';
import PawLogo from './PawLogo';

const LinkedinIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
    <rect x="2" y="9" width="4" height="12"/>
    <circle cx="4" cy="4" r="2"/>
  </svg>
);

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/dashboard/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/dashboard/profile', icon: User, label: 'My Profile' },
  { to: '/dashboard/resume', icon: FileText, label: 'Resume' },
  { to: '/dashboard/applications', icon: FolderOpen, label: 'Applications' },
  { to: '/dashboard/mail', icon: Mail, label: 'Mail Automation' },
  { to: '/dashboard/linkedin', icon: LinkedinIcon, label: 'LinkedIn Automation' },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const name = getUserName(user);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <a className="brand" href="/"><PawLogo size={28} />HAMZO</a>
          <button className="sidebar-close" onClick={onClose}><X size={18} /></button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Menu</div>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={name} />
            ) : (
              <span>{(name || 'U')[0].toUpperCase()}</span>
            )}
          </div>
          <div className="sidebar-user-info">
            <strong>{name}</strong>
            <small>{user?.email || ''}</small>
          </div>
          <button className="sidebar-logout" onClick={handleLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
