import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'mailmind_token';
const USER_KEY = 'wayin_user';
const API_URL = '';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState(null);

  const setToken = useCallback((t) => {
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    setTokenState(t);
  }, []);

  const fetchUser = useCallback(async (jwt) => {
    try {
      const res = await fetch(`/api/dashboard`, {
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      const u = {
        id: data.user?.id,
        email: data.user?.email || data.user?.gmailConnection?.gmailEmail || '',
        displayName: data.user?.displayName || '',
        avatarUrl: data.user?.avatarUrl || '',
        gmailConnected: data.user?.gmailConnection?.connected || false,
        gmailEmail: data.user?.gmailConnection?.gmailEmail || '',
      };
      setUser(u);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      return u;
    } catch {
      // Try cached user
      const cached = localStorage.getItem(USER_KEY);
      if (cached) {
        const u = JSON.parse(cached);
        setUser(u);
        return u;
      }
      return null;
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setTokenState(stored);
      fetchUser(stored).finally(() => setLoading(false));
    } else {
      // Demo fallback — allow exploring without backend
      const cached = localStorage.getItem(USER_KEY);
      if (cached) {
        setUser(JSON.parse(cached));
      }
      setLoading(false);
    }
  }, [fetchUser]);

  const loginGoogle = useCallback(async () => {
    const res = await fetch(`/api/auth/google-url`);
    if (!res.ok) {
      throw new Error(`Backend error (${res.status}): Failed to retrieve Google Auth URL. Please ensure the backend server is running on port 3000.`);
    }
    const data = await res.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      throw new Error('No authorization URL returned by the backend.');
    }
  }, []);

  const loginDemo = useCallback(() => {
    const demoUser = {
      id: 'demo-user-1',
      email: 'user@example.com',
      displayName: 'Demo User',
      avatarUrl: '',
      gmailConnected: false,
      gmailEmail: '',
    };
    setUser(demoUser);
    localStorage.setItem(USER_KEY, JSON.stringify(demoUser));
    setToken('demo_token');
  }, [setToken]);

  const requestOtp = useCallback(async (email) => {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send the login code.');
    return data;
  }, []);

  const verifyOtp = useCallback(async (email, otp) => {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The code is invalid or expired.');
    setUser(data.user);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.token);
    return data.user;
  }, [setToken]);

  const handleCallback = useCallback(async (jwt) => {
    setToken(jwt);
    await fetchUser(jwt);
  }, [setToken, fetchUser]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('wayin_profile');
    localStorage.removeItem('wayin_resumes');
    localStorage.removeItem('wayin_applications');
  }, [setToken]);

  const isAuthenticated = Boolean(token || user);

  return (
    <AuthContext.Provider value={{ user, token, loading, isAuthenticated, login: loginGoogle, loginGoogle, loginDemo, requestOtp, verifyOtp, logout, handleCallback, fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
