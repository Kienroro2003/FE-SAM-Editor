import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/auth/AuthShell';
import { authApi } from '../../shared/api/authApi';
import { useAuth } from '../../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../../shared/utils/errors';

type BusyAction = 'verifyOtp' | 'resendOtp' | null;

interface VerifyLocationState {
  message?: string;
}

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { isAuthenticated, setSession } = useAuth();

  const initialEmail = params.get('email') || '';
  const state = (location.state as VerifyLocationState | null) ?? null;

  const [email, setEmail] = useState(initialEmail);
  const [otpCode, setOtpCode] = useState('');
  const [message, setMessage] = useState(state?.message || '');
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);

  const canSubmitVerify = useMemo(
    () => email.trim().length > 0 && otpCode.trim().length > 0,
    [email, otpCode],
  );

  if (isAuthenticated) {
    return <Navigate to="/workspace" replace />;
  }

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction('verifyOtp');
    setError('');
    setMessage('');

    try {
      const response = await authApi.verifyOtp({ email: email.trim(), otpCode: otpCode.trim() });
      setSession(response.data);
      navigate('/workspace');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to verify OTP'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResendOtp = async () => {
    if (email.trim().length === 0) {
      setError('Please provide email to resend OTP.');
      return;
    }

    setBusyAction('resendOtp');
    setError('');
    setMessage('');

    try {
      const response = await authApi.resendOtp(email.trim());
      setMessage(response.data.message || 'OTP has been resent.');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to resend OTP'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <AuthShell
      title="Verify OTP"
      subtitle="Enter the OTP sent to your email to finish sign in."
      message={message}
      error={error}
      loadingText={
        busyAction === 'verifyOtp'
          ? 'Verifying OTP and creating your session...'
          : busyAction === 'resendOtp'
            ? 'Requesting a new OTP...'
            : undefined
      }
    >
      <form className="auth-form auth-form-otp" onSubmit={handleVerifyOtp}>
        <input
          className="auth-input"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="auth-input"
          inputMode="numeric"
          placeholder="OTP code"
          value={otpCode}
          onChange={(event) => setOtpCode(event.target.value)}
          required
        />

        <button className="auth-primary-button" disabled={busyAction !== null || !canSubmitVerify} type="submit">
          {busyAction === 'verifyOtp' ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Verifying...
            </span>
          ) : (
            'Verify OTP'
          )}
        </button>

        <button
          className="auth-ghost-button"
          disabled={busyAction !== null || email.trim().length === 0}
          type="button"
          onClick={handleResendOtp}
        >
          {busyAction === 'resendOtp' ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Resending...
            </span>
          ) : (
            'Resend OTP'
          )}
        </button>
      </form>

      <nav className="auth-links" aria-label="Authentication links">
        <Link to="/auth/login">Back to login</Link>
        <Link to="/auth/register">Create account</Link>
      </nav>
    </AuthShell>
  );
}
