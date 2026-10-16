import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';

export default function Auth() {
  const { isAuthenticated, loginGoogle, loginDemo } = useAuth();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (isAuthenticated) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const handleGoogleLogin = async () => {
    setConnecting(true);
    setErrorMsg('');
    try {
      await loginGoogle();
    } catch (err) {
      console.error('Google Auth Error:', err);
      setErrorMsg('Failed to connect to Google OAuth backend. Please ensure the backend server is running on port 3000 (npm run dev).');
      setConnecting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-ambient" />
      <div className="auth-card">
        <a className="brand" href="/"><i />HAMZO</a>
        <h1>Welcome to Wayin</h1>
        <p>Sign in with your Google Account to access your career workspace. You can connect Gmail later from the Mail page.</p>

        {errorMsg && (
          <div className="auth-error-banner" style={{
            background: '#fde8e8',
            border: '1px solid #f8b4b4',
            color: '#c74a3d',
            fontSize: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            marginBottom: '16px',
            textAlign: 'left',
            lineHeight: '1.5'
          }}>
            <strong>Google Sign-In Error:</strong> {errorMsg}
          </div>
        )}

        <button className="auth-google-btn" onClick={handleGoogleLogin} disabled={connecting}>
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
          </svg>
          {connecting ? 'Redirecting to Google…' : 'Continue with Google'}
          <ArrowRight size={16} />
        </button>

        <div className="auth-divider"><span>or</span></div>

        <button className="btn-ghost full" onClick={loginDemo} style={{ justifyContent: 'center' }}>
          Explore Demo Mode (Offline Preview)
        </button>

        <p className="auth-note" style={{ marginTop: '20px' }}>
          <Sparkles size={13} />
          Sign in first. Connect Gmail from Mail when you are ready.
        </p>
      </div>
      <footer className="auth-footer">© 2026 Wayin · <a href="/">Back to home</a></footer>
    </div>
  );
}
