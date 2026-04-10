import type { ReactNode } from 'react';
import { LoadingState } from '../common/LoadingState';

interface AuthShellProps {
  title: string;
  subtitle: string;
  message?: string;
  error?: string;
  loadingText?: string;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, message, error, loadingText, children }: AuthShellProps) {
  return (
    <main className="auth-page">
      <section className="auth-card compact">
        <h1>BE-SAM-Editor</h1>
        <p className="auth-subtitle">{subtitle}</p>

        <div className="auth-steps" aria-label="Authentication navigation">
          <span>{title}</span>
        </div>

        {loadingText && <LoadingState message={loadingText} compact className="feedback loading" />}

        {message && <div className="feedback success">{message}</div>}
        {error && <div className="feedback error">{error}</div>}

        {children}
      </section>
    </main>
  );
}
