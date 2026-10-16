import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Briefcase, User, FolderOpen, Mail } from 'lucide-react';

const items = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home', end: true },
  { to: '/dashboard/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/dashboard/profile', icon: User, label: 'Profile' },
  { to: '/dashboard/applications', icon: FolderOpen, label: 'Apps' },
  { to: '/dashboard/mail', icon: Mail, label: 'Mail' },
];

export default function MobileNav() {
  return (
    <nav className="mobile-nav">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
