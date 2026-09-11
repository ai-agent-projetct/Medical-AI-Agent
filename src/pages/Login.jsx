import React, { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { HeartPulse } from 'lucide-react';
import { auth } from '../firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setMessage(err.code === 'auth/invalid-credential' ? 'Wrong email or password.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email) return setMessage('Enter your email first.');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent.');
    } catch (err) {
      setMessage(err.message);
    }
    return undefined;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main, #f5f6fb)' }}>
      <form className="card" style={{ width: 400 }} onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <HeartPulse size={26} style={{ color: 'var(--primary)' }} />
          <h2 style={{ margin: 0 }}>ABC Healthcare Portal</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Sign in with your hospital account.</p>
        <div className="form-group">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" className="form-input" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" className="form-input" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {message && <p role="alert" style={{ fontSize: '0.85rem', color: 'var(--danger)', marginBottom: 12 }}>{message}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Login'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={reset} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>
          Forgot password
        </button>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 16 }}>
          Doctors: use the same account as the mobile app. Staff accounts are created by the hospital admin.
        </p>
      </form>
    </div>
  );
}
