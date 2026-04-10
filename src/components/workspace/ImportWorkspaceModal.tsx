import type { ChangeEvent, FormEvent } from 'react';
import { LoadingState } from '../common/LoadingState';

type ImportAction = 'github' | 'zip' | null;

interface ImportWorkspaceModalProps {
  isOpen: boolean;
  activeImportAction: ImportAction;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  onImportGithub: (event: FormEvent<HTMLFormElement>) => void;
  folderInputRef: (input: HTMLInputElement | null) => void;
  onFolderChange: (event: ChangeEvent<HTMLInputElement>) => void;
  selectedFolderName: string;
  folderFilesCount: number;
  zipWorkspaceName: string;
  onZipWorkspaceNameChange: (value: string) => void;
  onImportZip: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function ImportWorkspaceModal({
  isOpen,
  activeImportAction,
  repoUrl,
  onRepoUrlChange,
  onImportGithub,
  folderInputRef,
  onFolderChange,
  selectedFolderName,
  folderFilesCount,
  zipWorkspaceName,
  onZipWorkspaceNameChange,
  onImportZip,
  onClose,
}: ImportWorkspaceModalProps) {
  if (!isOpen) {
    return null;
  }

  const isImporting = activeImportAction !== null;
  const loadingMessage =
    activeImportAction === 'github'
      ? 'Importing repository and syncing workspace...'
      : activeImportAction === 'zip'
        ? 'Packaging folder and uploading workspace...'
        : null;

  return (
    <section
      className="import-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Import workspace dialog"
      onClick={isImporting ? undefined : onClose}
    >
      <div className="import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="import-modal-header">
          <h2>Import Workspace</h2>
          <button type="button" className="button-secondary" onClick={onClose} disabled={isImporting}>
            Close
          </button>
        </div>

        {loadingMessage && <LoadingState message={loadingMessage} compact className="import-loading-banner" />}

        <div className="import-modal-grid">
          <div className="panel">
            <h2>Import from GitHub</h2>
            <p className="panel-muted panel-description">Dán link repository public/private rồi import vào workspace.</p>
            <form onSubmit={onImportGithub} className="form-stack">
              <input
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(event) => onRepoUrlChange(event.target.value)}
                disabled={isImporting}
                required
              />
              <button type="submit" disabled={isImporting}>
                {activeImportAction === 'github' ? (
                  <span className="button-loading-content">
                    <span className="loading-spinner" aria-hidden="true" />
                    Importing...
                  </span>
                ) : (
                  'Import GitHub'
                )}
              </button>
            </form>
          </div>

          <div className="panel">
            <h2>Import Local Folder</h2>
            <p className="panel-muted panel-description">Chọn folder, hệ thống tự zip và tải lên backend.</p>
            <form onSubmit={onImportZip} className="form-stack">
              <input ref={folderInputRef} type="file" multiple onChange={onFolderChange} required disabled={isImporting} />
              <span className="panel-muted">
                {selectedFolderName
                  ? `Selected folder: ${selectedFolderName} (${folderFilesCount} files)`
                  : 'Choose a folder; the app will zip it before upload.'}
              </span>
              <input
                placeholder="Optional workspace name"
                value={zipWorkspaceName}
                onChange={(event) => onZipWorkspaceNameChange(event.target.value)}
                disabled={isImporting}
              />
              <button type="submit" disabled={isImporting}>
                {activeImportAction === 'zip' ? (
                  <span className="button-loading-content">
                    <span className="loading-spinner" aria-hidden="true" />
                    Uploading...
                  </span>
                ) : (
                  'Upload Folder'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
