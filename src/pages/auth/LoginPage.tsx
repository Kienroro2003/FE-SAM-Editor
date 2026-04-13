import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/auth/AuthShell';
import { authApi } from '../../shared/api/authApi';
import { useAuth } from '../../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../../shared/utils/errors';

type BusyAction = 'login' | 'github' | null;

const apiOrigin = import.meta.env.VITE_API_ORIGIN || 'http://localhost:8080';
const githubAuthorizationPath = '/oauth2/authorization/github';

export function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, setSession } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const canSubmitLogin = useMemo(
    () => email.trim().length > 0 && password.trim().length > 0,
    [email, password],
  );

  if (isAuthenticated) {
    return <Navigate to="/workspace" replace />;
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction('login');
    setError('');
    setMessage('');

    try {
      const response = await authApi.login({ email: email.trim(), password });
      setSession(response.data);
      navigate('/workspace');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to login'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleGithubLogin = () => {
    setBusyAction('github');
    setError('');
    setMessage('');

    try {
      const target = new URL(githubAuthorizationPath, apiOrigin).toString();
      window.location.assign(target);
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to redirect GitHub login'));
      setBusyAction(null);
    }
  };

  return (
    <AuthShell
      message={message}
      error={error}
      loadingText={
        busyAction === 'login'
          ? 'Authenticating and starting your session...'
          : busyAction === 'github'
            ? 'Redirecting to GitHub...'
            : undefined
      }
    >
      <form className="auth-form auth-form-login" onSubmit={handleLogin}>
        <input
          className="auth-input"
          placeholder="Username or Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="auth-input"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        <button className="auth-primary-button" disabled={busyAction !== null || !canSubmitLogin} type="submit">
          {busyAction === 'login' ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Logging in...
            </span>
          ) : (
            'Login'
          )}
        </button>

        <button
          className="auth-ghost-button"
          disabled={busyAction !== null}
          type="button"
          onClick={handleGithubLogin}
        >
          {busyAction === 'github' ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Connecting...
            </span>
          ) : (
            'Sign in with GitHub'
          )}
        </button>
      </form>

      <nav className="auth-links" aria-label="Authentication links">
        <Link to="/auth/register">Create account</Link>
      </nav>
    </AuthShell>
  );
}
