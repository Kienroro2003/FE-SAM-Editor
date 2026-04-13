import type { ReactNode } from 'react';
import { LoadingState } from '../common/LoadingState';

interface AuthShellProps {
  title?: string;
  subtitle?: string;
  message?: string;
  error?: string;
  loadingText?: string;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, message, error, loadingText, children }: AuthShellProps) {
  return (
    <main className="auth-page">
      <div className="auth-shape auth-shape-left" aria-hidden="true" />
      <div className="auth-shape auth-shape-dot" aria-hidden="true" />
      <div className="auth-shape auth-shape-rings" aria-hidden="true" />
      <div className="auth-shape auth-shape-triangles" aria-hidden="true" />

      <section className="auth-card auth-card-sample">
        <header className="auth-brand-block">
          <h1 className="auth-brand-title">SAM Editor</h1>
          <h2 className="auth-brand-description">
            Static analysis workspace for reading source code, tracking coverage, and improving test quality.
          </h2>
        </header>

        {title ? <h2 className="auth-title">{title.toLowerCase()}</h2> : null}
        {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}

        {loadingText && <LoadingState message={loadingText} compact className="feedback loading" />}

        {message && <div className="feedback success">{message}</div>}
        {error && <div className="feedback error">{error}</div>}

        {children}
      </section>
    </main>
  );
}
