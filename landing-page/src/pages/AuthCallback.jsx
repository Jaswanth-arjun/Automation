import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import VideoLoader from '../components/VideoLoader';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { handleCallback } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    const connected = params.get('connected');
    const login = params.get('login');
    const email = params.get('email');
    const name = params.get('name') || '';
    const picture = params.get('picture') || '';

    if (token) {
      handleCallback(token).then(() => {
        navigate('/dashboard', { replace: true });
      });
      return;
    }

    if (login === 'true' && email) {
      const googleUser = {
        id: `google-${email}`,
        email,
        displayName: name || email.split('@')[0],
        avatarUrl: picture,
        gmailConnected: false,
        gmailEmail: '',
      };
      localStorage.setItem('wayin_user', JSON.stringify(googleUser));
      localStorage.setItem('mailmind_token', 'google_oauth_session');
      localStorage.removeItem('mailmind_gmail_connected');
      localStorage.removeItem('mailmind_gmail_email');

      handleCallback('google_oauth_session').then(() => {
        navigate('/dashboard', { replace: true });
      });
      return;
    }

    if (connected === 'true' && email) {
      const existingRaw = localStorage.getItem('wayin_user');
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const sessionUser = {
        ...(existing || {}),
        id: existing?.id || `google-${email}`,
        email: existing?.email || email,
        displayName: existing?.displayName || email.split('@')[0],
        avatarUrl: existing?.avatarUrl || '',
        gmailConnected: true,
        gmailEmail: email,
      };
      localStorage.setItem('wayin_user', JSON.stringify(sessionUser));
      localStorage.setItem('mailmind_gmail_connected', 'true');
      localStorage.setItem('mailmind_gmail_email', email);
      if (!localStorage.getItem('mailmind_token')) {
        localStorage.setItem('mailmind_token', 'google_oauth_session');
      }

      handleCallback(localStorage.getItem('mailmind_token') || 'google_oauth_session').then(() => {
        navigate(`/dashboard/mail?connected=true&email=${encodeURIComponent(email)}`, { replace: true });
      });
      return;
    }

    navigate('/auth', { replace: true });
  }, [params, handleCallback, navigate]);

  return <VideoLoader isLoading={true} />;
}
