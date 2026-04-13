import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext';

export function OAuthSuccessPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const errorMessage = params.get('error');

  const payload = useMemo(() => {
    const accessToken = params.get('token');
    const refreshToken = params.get('refreshToken');
    if (!accessToken) {
      return null;
    }
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      email: '',
      fullName: '',
    };
  }, [params]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    setSession(payload);
    navigate('/workspace', { replace: true });
  }, [payload, setSession, navigate]);

  if (!payload) {
    return (
      <main className="oauth-page">
        <section className="oauth-card">
          <p className="oauth-brand">SAM Editor</p>
          <h1>GitHub Login Failed</h1>
          <p>{errorMessage || 'Missing token in callback URL. Please retry.'}</p>
          <Link to="/auth/login">Back to Login</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="oauth-page">
      <section className="oauth-card">
        <p className="oauth-brand">SAM Editor</p>
        <h1>Signing in...</h1>
        <p className="button-loading-content">
          <span className="loading-spinner" aria-hidden="true" />
          Redirecting to workspace.
        </p>
      </section>
    </main>
  );
}
