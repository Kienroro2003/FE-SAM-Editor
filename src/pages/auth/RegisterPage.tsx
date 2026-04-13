import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/auth/AuthShell';
import { authApi } from '../../shared/api/authApi';
import { useAuth } from '../../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../../shared/utils/errors';

export function RegisterPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/workspace" replace />;
  }

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const response = await authApi.register({
        email: email.trim(),
        fullName: fullName.trim(),
        password,
      });
      const successMessage = response.data.message || 'OTP has been sent to your email.';
      navigate(`/auth/verify-otp?email=${encodeURIComponent(email.trim())}`, {
        state: { message: successMessage },
      });
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to register'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      error={error}
      loadingText={isSubmitting ? 'Creating account and sending OTP...' : undefined}
    >
      <form className="auth-form auth-form-register" onSubmit={handleRegister}>
        <input
          className="auth-input"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="auth-input"
          placeholder="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
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

        <button className="auth-primary-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Sending OTP...
            </span>
          ) : (
            'Register + Send OTP'
          )}
        </button>
      </form>

      <nav className="auth-links" aria-label="Authentication links">
        <Link to="/auth/login">Back to login</Link>
      </nav>
    </AuthShell>
  );
}
