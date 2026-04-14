import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/auth/AuthShell';
import { authApi } from '../../shared/api/authApi';
import { useAuth } from '../../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../../shared/utils/errors';

export function RegisterPage() {
  const navigate = useNavigate();
  const { isAuthenticated, authError, clearAuthError } = useAuth();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayedError = error || authError;

  if (isAuthenticated) {
    return <Navigate to="/workspace" replace />;
  }

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    clearAuthError();
    setError('');

    try {
      const response = await authApi.register({ email, fullName, password });
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
      title="Register"
      subtitle="Tạo tài khoản mới để nhận OTP xác thực qua email."
      error={displayedError}
      loadingText={isSubmitting ? 'Creating account and sending OTP...' : undefined}
    >
      <form className="auth-form auth-form-single" onSubmit={handleRegister}>
        <h2>Register</h2>
        <input
          placeholder="Email"
          value={email}
          onChange={(event) => {
            if (authError) {
              clearAuthError();
            }
            setEmail(event.target.value);
          }}
          required
        />
        <input
          placeholder="Full name"
          value={fullName}
          onChange={(event) => {
            if (authError) {
              clearAuthError();
            }
            setFullName(event.target.value);
          }}
          required
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(event) => {
            if (authError) {
              clearAuthError();
            }
            setPassword(event.target.value);
          }}
          required
        />

        <button disabled={isSubmitting} type="submit">
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
