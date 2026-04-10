interface LoadingStateProps {
  message: string;
  compact?: boolean;
  className?: string;
}

export function LoadingState({ message, compact = false, className = '' }: LoadingStateProps) {
  const classes = ['loading-state', compact ? 'compact' : '', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
