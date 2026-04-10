import { useCallback, useMemo, useState } from 'react';
import type { WorkspaceTreeNodeResponse } from '../../shared/api/types';
import { LoadingState } from '../common/LoadingState';

interface WorkspaceTreeProps {
  nodes: WorkspaceTreeNodeResponse[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onBackToProjects: () => void;
  isLoading: boolean;
}

interface TreeNodeItemProps {
  node: WorkspaceTreeNodeResponse;
  depth: number;
  selectedPath: string | null;
  expanded: Record<string, boolean>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function filterTreeNodes(nodes: WorkspaceTreeNodeResponse[], query: string): WorkspaceTreeNodeResponse[] {
  return nodes.reduce<WorkspaceTreeNodeResponse[]>((accumulator, node) => {
    const normalizedName = node.name.toLowerCase();
    const normalizedPath = node.path.toLowerCase();
    const isMatch = normalizedName.includes(query) || normalizedPath.includes(query);

    if (node.type === 'folder') {
      const children = filterTreeNodes(node.children ?? [], query);
      if (isMatch || children.length > 0) {
        accumulator.push({
          ...node,
          children: children.length > 0 ? children : node.children,
        });
      }
      return accumulator;
    }

    if (isMatch) {
      accumulator.push(node);
    }
    return accumulator;
  }, []);
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  expanded,
  onToggleFolder,
  onSelectFile,
}: TreeNodeItemProps) {
  const isFolder = node.type === 'folder';
  const isExpanded = expanded[node.path] ?? depth < 1;
  const isSelected = selectedPath === node.path;

  if (isFolder) {
    return (
      <div>
        <button
          type="button"
          className="tree-node folder"
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => onToggleFolder(node.path)}
        >
          <span className="tree-icon">{isExpanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </button>
        {isExpanded && node.children?.map((child) => (
          <TreeNodeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree-node file ${isSelected ? 'active' : ''}`}
      style={{ paddingLeft: 10 + depth * 16 }}
      onClick={() => onSelectFile(node.path)}
      title={node.path}
    >
      <span className="tree-icon">•</span>
      <span>{node.name}</span>
    </button>
  );
}

export function WorkspaceTree({ nodes, selectedPath, onSelectFile, onBackToProjects, isLoading }: WorkspaceTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodes = useMemo(() => {
    if (!normalizedQuery) {
      return nodes;
    }
    return filterTreeNodes(nodes, normalizedQuery);
  }, [nodes, normalizedQuery]);

  const hasNodes = visibleNodes.length > 0;

  const handleToggleFolder = useCallback((path: string) => {
    setExpanded((previous) => ({
      ...previous,
      [path]: !(previous[path] ?? true),
    }));
  }, []);

  return (
    <div className="workspace-tree">
      <div className="tree-toolbar">
        <button
          type="button"
          className="tree-nav-button"
          onClick={onBackToProjects}
          aria-label="Back to workspace projects"
          title="Back to workspace projects"
          disabled={isLoading}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M14.71 6.29a1 1 0 0 1 0 1.41L11.41 11H20a1 1 0 1 1 0 2h-8.59l3.3 3.29a1 1 0 1 1-1.42 1.42l-5-5a1 1 0 0 1 0-1.42l5-5a1 1 0 0 1 1.42 0Z"
            />
          </svg>
        </button>
        <input
          className="workspace-search-input"
          placeholder="Filter files..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={isLoading}
        />
        {query && (
          <button type="button" className="tree-clear-button" onClick={() => setQuery('')} disabled={isLoading}>
            Clear
          </button>
        )}
      </div>

      {isLoading && <LoadingState message="Loading workspace tree..." className="panel-loading" />}

      {!isLoading && !hasNodes && (
        <div className="panel-muted">
          {nodes.length === 0 ? 'Select a workspace to load files.' : 'No file matched your search.'}
        </div>
      )}

      {!isLoading && visibleNodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expanded={expanded}
          onToggleFolder={handleToggleFolder}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
