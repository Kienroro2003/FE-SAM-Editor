import { useMemo, useState } from 'react';
import type { WorkspaceSummaryResponse } from '../../shared/api/types';
import { formatDateTime } from '../../shared/utils/format';
import { LoadingState } from '../common/LoadingState';

interface WorkspaceListProps {
  items: WorkspaceSummaryResponse[];
  selectedProjectId: number | null;
  onSelect: (projectId: number) => void;
  onDelete: (workspace: WorkspaceSummaryResponse) => void;
  deletingProjectId: number | null;
  isLoading: boolean;
}

export function WorkspaceList({
  items,
  selectedProjectId,
  onSelect,
  onDelete,
  deletingProjectId,
  isLoading,
}: WorkspaceListProps) {
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return items;
    }
    return items.filter((workspace) => {
      const sourceType = workspace.sourceType?.toString().toLowerCase() ?? '';
      return workspace.name.toLowerCase().includes(normalizedQuery) || sourceType.includes(normalizedQuery);
    });
  }, [items, normalizedQuery]);

  if (isLoading) {
    return <LoadingState message="Loading workspaces..." className="panel-loading" />;
  }

  if (items.length === 0) {
    return <div className="panel-muted">No workspace available.</div>;
  }

  const hasMatches = filteredItems.length > 0;

  return (
    <div className="workspace-list-shell">
      <div className="workspace-list-toolbar">
        <input
          className="workspace-search-input"
          placeholder="Find workspace..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="panel-muted">{filteredItems.length}/{items.length}</span>
      </div>

      {!hasMatches && <div className="panel-muted">No workspace matched your search.</div>}

      <div className="workspace-list">
        {filteredItems.map((workspace) => {
          const isActive = workspace.projectId === selectedProjectId;
          const isDeleting = deletingProjectId === workspace.projectId;
          return (
            <div key={workspace.projectId} className="workspace-item-row">
              <button
                type="button"
                className={`workspace-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(workspace.projectId)}
                disabled={isDeleting}
              >
                <div className="workspace-item-header">
                  <div className="workspace-item-title">{workspace.name}</div>
                  <span className="workspace-badge">{workspace.sourceType}</span>
                </div>
                <div className="workspace-item-meta">Updated: {formatDateTime(workspace.updatedAt)}</div>
              </button>

              <button
                type="button"
                className="workspace-item-delete"
                onClick={() => onDelete(workspace)}
                disabled={deletingProjectId !== null}
                aria-label={`Delete ${workspace.name}`}
                title={`Delete ${workspace.name}`}
              >
                {isDeleting ? (
                  <span className="loading-spinner" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h1.09l.84 12.09A2 2 0 0 0 8.93 21h6.14a2 2 0 0 0 2-1.91L17.91 7H19a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm5 2h-4V4h4v1Zm1.9 2-.82 12H8.92L8.1 7h7.8ZM10 9a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Z"
                    />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
