import type { WorkspaceSummaryResponse } from '../../shared/api/types';

interface DeleteWorkspaceModalProps {
  candidate: WorkspaceSummaryResponse | null;
  deletingProjectId: number | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteWorkspaceModal({
  candidate,
  deletingProjectId,
  onClose,
  onConfirm,
}: DeleteWorkspaceModalProps) {
  if (!candidate) {
    return null;
  }

  return (
    <section
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete workspace confirmation"
      onClick={onClose}
    >
      <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-badge">Delete Workspace</div>
        <h2>Delete “{candidate.name}”?</h2>
        <p className="panel-muted">
          Workspace sẽ bị xóa vĩnh viễn khỏi hệ thống, bao gồm tất cả file đã import.
        </p>
        <div className="confirm-detail">
          <span>ID: {candidate.projectId}</span>
          <span>Source: {candidate.sourceType}</span>
        </div>
        <div className="confirm-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={deletingProjectId !== null}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={onConfirm}
            disabled={deletingProjectId !== null}
          >
            {deletingProjectId !== null ? (
              <span className="button-loading-content">
                <span className="loading-spinner" aria-hidden="true" />
                Deleting...
              </span>
            ) : (
              'Yes, Delete'
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
