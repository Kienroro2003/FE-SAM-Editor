import { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnalysisPanel, type AnalysisToolView } from '../components/workspace/AnalysisPanel';
import { CodeViewer } from '../components/workspace/CodeViewer';
import { DashboardPanel } from '../components/workspace/DashboardPanel';
import { DeleteWorkspaceModal } from '../components/workspace/DeleteWorkspaceModal';
import { ImportWorkspaceModal } from '../components/workspace/ImportWorkspaceModal';
import { WorkspaceList } from '../components/workspace/WorkspaceList';
import { authApi } from '../shared/api/authApi';
import { workspaceApi } from '../shared/api/workspaceApi';
import type {
  ImportGithubWorkspaceResponse,
  WorkspaceFileContentResponse,
  WorkspaceSummaryResponse,
  WorkspaceTreeNodeResponse,
  WorkspaceTreeResponse,
} from '../shared/api/types';
import type { CodeCoverageDecoration, CoverageTone } from '../shared/utils/coverage';
import { useAuth } from '../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../shared/utils/errors';
import { formatBytes } from '../shared/utils/format';
import { buildZipFromFolderFiles, resolveFolderName } from '../shared/utils/workspaceImport';

type ImportAction = 'github' | 'zip' | null;
type AuthAction = 'refresh' | 'logout' | 'logoutAll' | null;
type ActivityView = 'explorer' | 'search' | 'dashboard' | 'account';
type BottomPanelTab = 'terminal' | 'problems';
type InputDialogMode = 'rename' | 'new-file' | 'new-folder';

interface CodeFocusRequest {
  startLine: number;
  endLine: number | null;
  coverageTone: CoverageTone;
  requestKey: number;
}

interface ExplorerNode {
  path: string;
  name: string;
  type: 'file' | 'folder';
  language: string | null;
  children: ExplorerNode[];
  isVirtual: boolean;
}

interface PaletteCommand {
  id: string;
  label: string;
  shortcut: string;
  keywords: string;
  run: () => void;
}

interface ContextMenuItem {
  id: string;
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface InputDialogState {
  mode: InputDialogMode;
  targetPath: string | null;
  x: number;
  y: number;
  value: string;
}

interface DragState {
  kind: 'sidebar' | 'panel' | 'tool-panel';
  startPointer: number;
  startSize: number;
}

const SIDEBAR_MIN_WIDTH = 150;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 260;
const TOOL_PANEL_MIN_WIDTH = 340;
const TOOL_PANEL_MAX_WIDTH = 680;
const TOOL_PANEL_DEFAULT_WIDTH = 420;
const PANEL_DEFAULT_HEIGHT = 200;
const PANEL_MIN_HEIGHT = 120;
const PANEL_MAX_HEIGHT_RATIO = 0.7;
const VIRTUAL_PREFIX = 'virtual://';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveSidebarTitle(view: ActivityView): string {
  switch (view) {
    case 'search':
      return 'SEARCH';
    case 'account':
      return 'ACCOUNT';
    case 'dashboard':
      return 'DASHBOARD';
    default:
      return 'EXPLORER';
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function resolveParentPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  return normalized.slice(0, slashIndex);
}

function extensionFromName(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === name.length - 1) {
    return '';
  }
  return name.slice(dotIndex + 1).toLowerCase();
}

function inferLanguageFromFileName(name: string): string {
  const extension = extensionFromName(name);
  switch (extension) {
    case 'java':
      return 'JAVA';
    case 'ts':
    case 'tsx':
      return 'TYPESCRIPT';
    case 'js':
    case 'jsx':
      return 'JAVASCRIPT';
    case 'json':
      return 'JSON';
    case 'yml':
    case 'yaml':
      return 'YAML';
    case 'xml':
      return 'XML';
    case 'md':
      return 'MARKDOWN';
    case 'py':
      return 'PYTHON';
    default:
      return 'PLAINTEXT';
  }
}

function toExplorerNode(node: WorkspaceTreeNodeResponse): ExplorerNode {
  const type = node.type === 'folder' ? 'folder' : 'file';
  return {
    path: node.path,
    name: node.name,
    type,
    language: node.language,
    isVirtual: false,
    children: type === 'folder' ? (node.children ?? []).map(toExplorerNode) : [],
  };
}

function collectFolderPaths(nodes: ExplorerNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'folder') {
      return [];
    }
    return [node.path, ...collectFolderPaths(node.children)];
  });
}

function findExplorerNodeByPath(nodes: ExplorerNode[], path: string): ExplorerNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    const child = findExplorerNodeByPath(node.children, path);
    if (child) {
      return child;
    }
  }

  return null;
}

function renameExplorerNode(nodes: ExplorerNode[], targetPath: string, nextName: string): ExplorerNode[] {
  return nodes.map((node) => {
    const nextChildren = renameExplorerNode(node.children, targetPath, nextName);
    if (node.path === targetPath) {
      return {
        ...node,
        name: nextName,
        children: nextChildren,
      };
    }

    if (nextChildren !== node.children) {
      return {
        ...node,
        children: nextChildren,
      };
    }

    return node;
  });
}

function insertExplorerNode(nodes: ExplorerNode[], parentPath: string | null, nextNode: ExplorerNode): ExplorerNode[] {
  if (!parentPath) {
    return [...nodes, nextNode];
  }

  let inserted = false;

  const visit = (branch: ExplorerNode[]): ExplorerNode[] => {
    return branch.map((node) => {
      if (node.path === parentPath && node.type === 'folder') {
        inserted = true;
        return {
          ...node,
          children: [...node.children, nextNode],
        };
      }

      if (node.children.length === 0) {
        return node;
      }

      return {
        ...node,
        children: visit(node.children),
      };
    });
  };

  const nextNodes = visit(nodes);
  return inserted ? nextNodes : [...nextNodes, nextNode];
}

function filterExplorerNodes(nodes: ExplorerNode[], query: string): ExplorerNode[] {
  return nodes.reduce<ExplorerNode[]>((accumulator, node) => {
    const normalizedName = node.name.toLowerCase();
    const normalizedPath = node.path.toLowerCase();
    const isMatch = normalizedName.includes(query) || normalizedPath.includes(query);

    if (node.type === 'folder') {
      const children = filterExplorerNodes(node.children, query);
      if (isMatch || children.length > 0) {
        accumulator.push({
          ...node,
          children,
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

function resolveCreationParentPath(selectedPath: string | null, explorerNodes: ExplorerNode[]): string | null {
  if (!selectedPath) {
    return null;
  }

  const selectedNode = findExplorerNodeByPath(explorerNodes, selectedPath);
  if (!selectedNode) {
    return null;
  }

  if (selectedNode.type === 'folder') {
    return selectedNode.path;
  }

  return resolveParentPath(selectedNode.path);
}

function createFileIcon(name: string, language: string | null): { text: string; tone: string } {
  const extension = extensionFromName(name);

  switch (extension) {
    case 'java':
      return { text: 'J', tone: 'java' };
    case 'ts':
    case 'tsx':
      return { text: 'TS', tone: 'ts' };
    case 'js':
    case 'jsx':
      return { text: 'JS', tone: 'js' };
    case 'json':
      return { text: '{}', tone: 'json' };
    case 'md':
      return { text: 'MD', tone: 'md' };
    case 'xml':
      return { text: 'XML', tone: 'xml' };
    case 'yml':
    case 'yaml':
      return { text: 'YML', tone: 'yaml' };
    default:
      break;
  }

  if (language?.toUpperCase() === 'JAVA') {
    return { text: 'J', tone: 'java' };
  }

  return { text: 'TXT', tone: 'text' };
}

function resolveDialogTitle(mode: InputDialogMode): string {
  switch (mode) {
    case 'rename':
      return 'Rename Item';
    case 'new-file':
      return 'New File';
    case 'new-folder':
      return 'New Folder';
  }
}

function resolveDialogPlaceholder(mode: InputDialogMode): string {
  switch (mode) {
    case 'rename':
      return 'New name';
    case 'new-file':
      return 'filename.ts';
    case 'new-folder':
      return 'folder-name';
  }
}

function sanitizeName(rawName: string): string {
  return rawName.replace(/[\\/:*?"<>|]/g, '-').trim();
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const { tokens, profile, isProfileLoading, clearSession, setSession } = useAuth();

  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryResponse[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeResponse | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<WorkspaceFileContentResponse | null>(null);
  const [codeFocusRequest, setCodeFocusRequest] = useState<CodeFocusRequest | null>(null);
  const [codeCoverageDecorations, setCodeCoverageDecorations] = useState<CodeCoverageDecoration[]>([]);

  const [repoUrl, setRepoUrl] = useState('');
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [selectedFolderName, setSelectedFolderName] = useState('');
  const [zipWorkspaceName, setZipWorkspaceName] = useState('');
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [activeImportAction, setActiveImportAction] = useState<ImportAction>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);
  const [activeAuthAction, setActiveAuthAction] = useState<AuthAction>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<WorkspaceSummaryResponse | null>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [explorerNodes, setExplorerNodes] = useState<ExplorerNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [selectedExplorerPath, setSelectedExplorerPath] = useState<string | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState('');

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [fileCache, setFileCache] = useState<Record<string, WorkspaceFileContentResponse>>({});
  const [virtualFiles, setVirtualFiles] = useState<Record<string, WorkspaceFileContentResponse>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [savedContentByPath, setSavedContentByPath] = useState<Record<string, string>>({});

  const [activityView, setActivityView] = useState<ActivityView>('explorer');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [activeToolTab, setActiveToolTab] = useState<AnalysisToolView>('analysis');
  const [isToolPanelCollapsed, setIsToolPanelCollapsed] = useState(false);
  const [toolPanelWidth, setToolPanelWidth] = useState(TOOL_PANEL_DEFAULT_WIDTH);

  const [panelTab, setPanelTab] = useState<BottomPanelTab>('terminal');
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
  const [isPanelMaximized, setIsPanelMaximized] = useState(false);
  const [panelHeight, setPanelHeight] = useState(PANEL_DEFAULT_HEIGHT);

  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandCursor, setCommandCursor] = useState(0);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inputDialog, setInputDialog] = useState<InputDialogState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const [terminalEntries, setTerminalEntries] = useState<string[]>(['SAM workbench initialized.']);

  const treeItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const virtualCounterRef = useRef(1);

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.projectId === selectedProjectId) ?? null,
    [workspaces, selectedProjectId],
  );

  const isVirtualFileActive = useMemo(
    () => Boolean(selectedFilePath && selectedFilePath.startsWith(VIRTUAL_PREFIX)),
    [selectedFilePath],
  );

  const activeEditorFile = useMemo(() => {
    if (!selectedFilePath || !selectedFileContent) {
      return null;
    }

    const draft = draftContentByPath[selectedFilePath];
    if (draft == null) {
      return selectedFileContent;
    }

    return {
      ...selectedFileContent,
      content: draft,
      sizeBytes: draft.length,
    };
  }, [draftContentByPath, selectedFileContent, selectedFilePath]);

  const analysisSelectedFilePath = useMemo(() => {
    if (!selectedFilePath || isVirtualFileActive) {
      return null;
    }
    return selectedFilePath;
  }, [isVirtualFileActive, selectedFilePath]);

  const analysisSelectedFile = useMemo(() => {
    if (!analysisSelectedFilePath) {
      return null;
    }
    return selectedFileContent;
  }, [analysisSelectedFilePath, selectedFileContent]);
  const sidebarTitle = useMemo(() => resolveSidebarTitle(activityView), [activityView]);
  const activeToolTitle = useMemo(() => {
    if (activeToolTab === 'coverage') {
      return 'COVERAGE';
    }
    if (activeToolTab === 'ai') {
      return 'AI SUGGEST';
    }
    return 'ANALYSIS';
  }, [activeToolTab]);

  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const visibleExplorerNodes = useMemo(() => {
    if (!normalizedSidebarQuery) {
      return explorerNodes;
    }
    return filterExplorerNodes(explorerNodes, normalizedSidebarQuery);
  }, [explorerNodes, normalizedSidebarQuery]);

  const resolveTabTitle = useCallback(
    (path: string): string => {
      const node = findExplorerNodeByPath(explorerNodes, path);
      return node?.name ?? fileNameFromPath(path);
    },
    [explorerNodes],
  );

  const appendTerminalEntry = useCallback((entry: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalEntries((previous) => {
      const next = [...previous, `[${timestamp}] ${entry}`];
      return next.slice(-60);
    });
  }, []);

  const clearFeedback = useCallback(() => {
    setError('');
    setMessage('');
  }, []);

  const clearCodeViewerState = useCallback(() => {
    setCodeFocusRequest(null);
    setCodeCoverageDecorations([]);
  }, []);

  const clearWorkbenchState = useCallback(() => {
    setSelectedFilePath(null);
    setSelectedFileContent(null);
    setOpenTabs([]);
    setFileCache({});
    setVirtualFiles({});
    setDraftContentByPath({});
    setSavedContentByPath({});
    setExplorerNodes([]);
    setExpandedFolders({});
    setSelectedExplorerPath(null);
    setSidebarQuery('');
    clearCodeViewerState();
  }, [clearCodeViewerState]);

  const loadWorkspaces = useCallback(async () => {
    setIsLoadingWorkspaces(true);
    try {
      const response = await workspaceApi.getMyWorkspaces();
      setWorkspaces(response.data);
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to load workspaces'));
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, []);

  const loadTree = useCallback(
    async (projectId: number) => {
      setIsLoadingTree(true);
      clearCodeViewerState();

      try {
        const response = await workspaceApi.getWorkspaceTree(projectId);
        setWorkspaceTree(response.data);
      } catch (err) {
        setWorkspaceTree(null);
        setError(resolveApiErrorMessage(err, 'Unable to load workspace tree'));
      } finally {
        setIsLoadingTree(false);
      }
    },
    [clearCodeViewerState],
  );

  const handleOpenVirtualFile = useCallback(
    (path: string) => {
      const virtualFile = virtualFiles[path];
      if (!virtualFile) {
        return;
      }

      setSelectedExplorerPath(path);
      setSelectedFilePath(path);
      setSelectedFileContent(virtualFile);
      setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
      clearCodeViewerState();
      appendTerminalEntry(`Opened ${resolveTabTitle(path)}.`);
    },
    [appendTerminalEntry, clearCodeViewerState, resolveTabTitle, virtualFiles],
  );

  const handleOpenFile = useCallback(
    async (path: string) => {
      if (!selectedProjectId) {
        return;
      }

      setSelectedExplorerPath(path);
      setSelectedFilePath(path);
      setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
      clearCodeViewerState();

      const cached = fileCache[path];
      if (cached) {
        setSelectedFileContent(cached);
        setDraftContentByPath((previous) => (previous[path] !== undefined ? previous : { ...previous, [path]: cached.content }));
        setSavedContentByPath((previous) => (previous[path] !== undefined ? previous : { ...previous, [path]: cached.content }));
        appendTerminalEntry(`Opened ${resolveTabTitle(path)}.`);
        return;
      }

      setIsLoadingFile(true);
      try {
        const response = await workspaceApi.getWorkspaceFileContent(selectedProjectId, path);
        setSelectedFileContent(response.data);
        setFileCache((previous) => ({
          ...previous,
          [path]: response.data,
        }));
        setDraftContentByPath((previous) => (previous[path] !== undefined ? previous : { ...previous, [path]: response.data.content }));
        setSavedContentByPath((previous) => (previous[path] !== undefined ? previous : { ...previous, [path]: response.data.content }));
        appendTerminalEntry(`Opened ${resolveTabTitle(path)}.`);
      } catch (err) {
        setSelectedFileContent(null);
        setError(resolveApiErrorMessage(err, 'Unable to load file content'));
      } finally {
        setIsLoadingFile(false);
      }
    },
    [appendTerminalEntry, clearCodeViewerState, fileCache, resolveTabTitle, selectedProjectId],
  );

  const handleActivateTab = useCallback(
    (path: string) => {
      if (path.startsWith(VIRTUAL_PREFIX)) {
        handleOpenVirtualFile(path);
        return;
      }

      const cached = fileCache[path];
      if (cached) {
        setSelectedExplorerPath(path);
        setSelectedFilePath(path);
        setSelectedFileContent(cached);
        clearCodeViewerState();
        return;
      }

      void handleOpenFile(path);
    },
    [clearCodeViewerState, fileCache, handleOpenFile, handleOpenVirtualFile],
  );

  const handleCloseTab = useCallback(
    (path: string) => {
      const nextTabs = openTabs.filter((item) => item !== path);
      setOpenTabs(nextTabs);

      if (selectedFilePath !== path) {
        return;
      }

      const nextActivePath = nextTabs[nextTabs.length - 1] ?? null;
      if (!nextActivePath) {
        setSelectedFilePath(null);
        setSelectedFileContent(null);
        setSelectedExplorerPath(null);
        clearCodeViewerState();
        return;
      }

      handleActivateTab(nextActivePath);
    },
    [clearCodeViewerState, handleActivateTab, openTabs, selectedFilePath],
  );

  const handleEditorContentChange = useCallback(
    (nextContent: string) => {
      if (!selectedFilePath) {
        return;
      }

      setDraftContentByPath((previous) => ({
        ...previous,
        [selectedFilePath]: nextContent,
      }));

      if (selectedFilePath.startsWith(VIRTUAL_PREFIX)) {
        setVirtualFiles((previous) => {
          const target = previous[selectedFilePath];
          if (!target) {
            return previous;
          }
          return {
            ...previous,
            [selectedFilePath]: {
              ...target,
              content: nextContent,
              sizeBytes: nextContent.length,
            },
          };
        });
      }
    },
    [selectedFilePath],
  );

  const handleSaveActive = useCallback(() => {
    if (!selectedFilePath) {
      return;
    }

    const nextDraft = draftContentByPath[selectedFilePath] ?? '';
    setSavedContentByPath((previous) => ({
      ...previous,
      [selectedFilePath]: nextDraft,
    }));
    setMessage(`Saved ${resolveTabTitle(selectedFilePath)} locally.`);
    appendTerminalEntry(`Saved ${resolveTabTitle(selectedFilePath)}.`);
  }, [appendTerminalEntry, draftContentByPath, resolveTabTitle, selectedFilePath]);

  const handleSaveAll = useCallback(() => {
    if (openTabs.length === 0) {
      return;
    }

    setSavedContentByPath((previous) => {
      const next = { ...previous };
      openTabs.forEach((path) => {
        next[path] = draftContentByPath[path] ?? previous[path] ?? '';
      });
      return next;
    });

    setMessage(`Saved ${openTabs.length} tabs locally.`);
    appendTerminalEntry(`Saved all (${openTabs.length}) open tabs.`);
  }, [appendTerminalEntry, draftContentByPath, openTabs]);

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((previous) => ({
      ...previous,
      [path]: !(previous[path] ?? true),
    }));
  }, []);

  const handleCollapseAllFolders = useCallback(() => {
    const collapsedState: Record<string, boolean> = {};
    collectFolderPaths(explorerNodes).forEach((path) => {
      collapsedState[path] = false;
    });
    setExpandedFolders(collapsedState);
    appendTerminalEntry('Collapsed all folders.');
  }, [appendTerminalEntry, explorerNodes]);

  const getDialogAnchor = useCallback((targetPath: string | null): { x: number; y: number } => {
    if (typeof window === 'undefined') {
      return { x: 24, y: 72 };
    }

    const targetElement = targetPath ? treeItemRefs.current[targetPath] : null;
    if (targetElement) {
      const targetRect = targetElement.getBoundingClientRect();
      return {
        x: clamp(targetRect.left + 22, 12, window.innerWidth - 280),
        y: clamp(targetRect.bottom + 6, 44, window.innerHeight - 130),
      };
    }

    return {
      x: clamp(window.innerWidth * 0.3, 12, window.innerWidth - 280),
      y: clamp(90, 44, window.innerHeight - 130),
    };
  }, []);

  const openInputDialog = useCallback(
    (mode: InputDialogMode, targetPath: string | null) => {
      const targetNode = targetPath ? findExplorerNodeByPath(explorerNodes, targetPath) : null;
      const anchor = getDialogAnchor(targetPath);
      const initialValue =
        mode === 'rename'
          ? targetNode?.name ?? ''
          : mode === 'new-file'
            ? 'untitled.ts'
            : 'new-folder';

      setContextMenu(null);
      setInputDialog({
        mode,
        targetPath,
        x: anchor.x,
        y: anchor.y,
        value: initialValue,
      });
    },
    [explorerNodes, getDialogAnchor],
  );

  const openCreateDialog = useCallback(
    (mode: 'new-file' | 'new-folder') => {
      const parentPath = resolveCreationParentPath(selectedExplorerPath, explorerNodes);
      openInputDialog(mode, parentPath);
    },
    [explorerNodes, openInputDialog, selectedExplorerPath],
  );

  const openRenameDialog = useCallback(() => {
    if (!selectedExplorerPath) {
      return;
    }
    openInputDialog('rename', selectedExplorerPath);
  }, [openInputDialog, selectedExplorerPath]);

  const handleSubmitInputDialog = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!inputDialog) {
        return;
      }

      const sanitizedName = sanitizeName(inputDialog.value);
      if (!sanitizedName) {
        return;
      }

      if (inputDialog.mode === 'rename') {
        if (!inputDialog.targetPath) {
          return;
        }

        setExplorerNodes((previous) => renameExplorerNode(previous, inputDialog.targetPath as string, sanitizedName));
        setMessage(`Renamed item to ${sanitizedName}.`);
        appendTerminalEntry(`Renamed item to ${sanitizedName}.`);
        setInputDialog(null);
        return;
      }

      const nextName = inputDialog.mode === 'new-file' && !sanitizedName.includes('.') ? `${sanitizedName}.txt` : sanitizedName;
      const parentPath = inputDialog.targetPath;
      const virtualPath = `${VIRTUAL_PREFIX}${parentPath ? `${parentPath}/` : ''}${nextName}#${virtualCounterRef.current}`;
      virtualCounterRef.current += 1;

      const nextNode: ExplorerNode = {
        path: virtualPath,
        name: nextName,
        type: inputDialog.mode === 'new-folder' ? 'folder' : 'file',
        language: inputDialog.mode === 'new-file' ? inferLanguageFromFileName(nextName) : null,
        children: [],
        isVirtual: true,
      };

      setExplorerNodes((previous) => insertExplorerNode(previous, parentPath, nextNode));
      setExpandedFolders((previous) => ({
        ...previous,
        ...(parentPath ? { [parentPath]: true } : {}),
        ...(nextNode.type === 'folder' ? { [nextNode.path]: true } : {}),
      }));
      setSelectedExplorerPath(nextNode.path);

      if (nextNode.type === 'file') {
        const initialDraft = [
          `// ${nextName}`,
          '// Scratch file created in browser workspace.',
          '',
        ].join('\n');

        const virtualFile: WorkspaceFileContentResponse = {
          projectId: selectedProjectId ?? 0,
          path: nextNode.path,
          language: nextNode.language ?? 'PLAINTEXT',
          content: initialDraft,
          sizeBytes: initialDraft.length,
        };

        setVirtualFiles((previous) => ({
          ...previous,
          [nextNode.path]: virtualFile,
        }));
        setDraftContentByPath((previous) => ({
          ...previous,
          [nextNode.path]: initialDraft,
        }));
        setSavedContentByPath((previous) => ({
          ...previous,
          [nextNode.path]: '',
        }));
        setSelectedFilePath(nextNode.path);
        setSelectedFileContent(virtualFile);
        setOpenTabs((previous) => (previous.includes(nextNode.path) ? previous : [...previous, nextNode.path]));
      }

      setMessage(`${inputDialog.mode === 'new-folder' ? 'Created folder' : 'Created file'} ${nextName}.`);
      appendTerminalEntry(`${inputDialog.mode === 'new-folder' ? 'Created folder' : 'Created file'} ${nextName}.`);
      setInputDialog(null);
    },
    [appendTerminalEntry, inputDialog, selectedProjectId],
  );

  const handleFolderInputRef = useCallback((input: HTMLInputElement | null) => {
    folderInputRef.current = input;
    if (!input) {
      return;
    }

    const folderPickerInput = input as HTMLInputElement & {
      webkitdirectory?: boolean;
      directory?: boolean;
      mozdirectory?: boolean;
    };

    folderPickerInput.webkitdirectory = true;
    folderPickerInput.directory = true;
    folderPickerInput.mozdirectory = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('mozdirectory', '');
  }, []);

  const handleFolderChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    const nextFolderName = resolveFolderName(nextFiles);
    setFolderFiles(nextFiles);
    setSelectedFolderName(nextFolderName);

    if (nextFiles.length > 0 && !nextFolderName) {
      setError('Please choose a folder (not individual files).');
      return;
    }
    setError('');
  }, []);

  const handleRequestDeleteWorkspace = useCallback(
    (workspace: WorkspaceSummaryResponse) => {
      setDeleteCandidate(workspace);
      clearFeedback();
    },
    [clearFeedback],
  );

  const handleCloseDeleteModal = useCallback(() => {
    if (deletingProjectId !== null) {
      return;
    }
    setDeleteCandidate(null);
  }, [deletingProjectId]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!deleteCandidate) {
      return;
    }

    const workspaceToDelete = deleteCandidate;

    setDeletingProjectId(workspaceToDelete.projectId);
    clearFeedback();

    try {
      const response = await workspaceApi.deleteWorkspace(workspaceToDelete.projectId);
      const payload = response.data;
      const fallbackMessage = `Deleted ${workspaceToDelete.name} (${payload.deletedFiles ?? 0} files).`;
      setMessage(payload.message?.trim() || fallbackMessage);

      setWorkspaces((previous) => previous.filter((workspace) => workspace.projectId !== workspaceToDelete.projectId));
      if (selectedProjectId === workspaceToDelete.projectId) {
        setSelectedProjectId(null);
        setWorkspaceTree(null);
        clearWorkbenchState();
      }
      setDeleteCandidate(null);
      appendTerminalEntry(`Deleted workspace ${workspaceToDelete.name}.`);
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to delete workspace'));
    } finally {
      setDeletingProjectId(null);
    }
  }, [appendTerminalEntry, clearFeedback, clearWorkbenchState, deleteCandidate, selectedProjectId]);

  const openActivityView = useCallback((nextView: ActivityView) => {
    setActivityView(nextView);
    setIsSidebarCollapsed(false);
  }, []);

  const openToolTab = useCallback((nextTab: AnalysisToolView) => {
    setActiveToolTab(nextTab);
    setIsToolPanelCollapsed(false);
    setToolPanelWidth((previous) => clamp(previous, TOOL_PANEL_MIN_WIDTH, TOOL_PANEL_MAX_WIDTH));
  }, []);

  const toggleToolPanel = useCallback(() => {
    setIsToolPanelCollapsed((previous) => !previous);
  }, []);

  const handleSelectWorkspace = useCallback(
    (projectId: number) => {
      setWorkspaceTree(null);
      clearWorkbenchState();
      setSelectedProjectId(projectId);
      openActivityView('explorer');
      clearFeedback();
      appendTerminalEntry(`Selected workspace #${projectId}.`);
    },
    [appendTerminalEntry, clearFeedback, clearWorkbenchState, openActivityView],
  );

  const handleBackToProjects = useCallback(() => {
    setSelectedProjectId(null);
    setWorkspaceTree(null);
    clearWorkbenchState();
    clearFeedback();
    appendTerminalEntry('Returned to workspace list.');
  }, [appendTerminalEntry, clearFeedback, clearWorkbenchState]);

  const handleImportGithub = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (repoUrl.trim().length === 0) {
        setError('Please provide a GitHub repository URL.');
        return;
      }

      setActiveImportAction('github');
      clearFeedback();
      try {
        const response = await workspaceApi.importGithub(repoUrl.trim());
        const imported = response.data;
        setMessage(`Imported ${imported.name} (${imported.totalFiles} files, ${formatBytes(imported.totalSizeBytes)}).`);
        setRepoUrl('');
        setIsImportModalOpen(false);
        await loadWorkspaces();
        setSelectedProjectId(imported.projectId);
        appendTerminalEntry(`Imported ${imported.name} from GitHub.`);
      } catch (err) {
        setError(resolveApiErrorMessage(err, 'Unable to import GitHub workspace'));
      } finally {
        setActiveImportAction(null);
      }
    },
    [appendTerminalEntry, clearFeedback, loadWorkspaces, repoUrl],
  );

  const handleImportZip = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (folderFiles.length === 0) {
        setError('Please select a folder to import.');
        return;
      }
      if (!selectedFolderName) {
        setError('Please choose a folder (not individual files).');
        return;
      }

      setActiveImportAction('zip');
      clearFeedback();
      try {
        const zippedFolder = await buildZipFromFolderFiles(folderFiles, selectedFolderName);
        const response = await workspaceApi.importFolder(zippedFolder, zipWorkspaceName);
        const imported = response.data as ImportGithubWorkspaceResponse;

        setMessage(`Imported ${imported.name} (${imported.totalFiles} files, ${formatBytes(imported.totalSizeBytes)}).`);
        setFolderFiles([]);
        setSelectedFolderName('');
        setZipWorkspaceName('');
        if (folderInputRef.current) {
          folderInputRef.current.value = '';
        }

        setIsImportModalOpen(false);
        await loadWorkspaces();
        setSelectedProjectId(imported.projectId);
        appendTerminalEntry(`Imported local folder as ${imported.name}.`);
      } catch (err) {
        setError(resolveApiErrorMessage(err, 'Unable to import local folder'));
      } finally {
        setActiveImportAction(null);
      }
    },
    [appendTerminalEntry, clearFeedback, folderFiles, loadWorkspaces, selectedFolderName, zipWorkspaceName],
  );

  const handleRefreshToken = useCallback(async () => {
    if (!tokens?.refreshToken) {
      setError('No refresh token available. Please login again.');
      return;
    }

    setActiveAuthAction('refresh');
    clearFeedback();
    try {
      const response = await authApi.refreshToken({ refreshToken: tokens.refreshToken });
      setSession(response.data);
      setMessage('Session refreshed successfully.');
      appendTerminalEntry('Refreshed auth session.');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to refresh session'));
    } finally {
      setActiveAuthAction(null);
    }
  }, [appendTerminalEntry, clearFeedback, setSession, tokens?.refreshToken]);

  const handleLogout = useCallback(async () => {
    setActiveAuthAction('logout');
    clearFeedback();
    try {
      if (tokens?.refreshToken) {
        await authApi.logout({ refreshToken: tokens.refreshToken });
      }
    } catch {
      // Ignore logout error and clear local session anyway.
    } finally {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [clearFeedback, clearSession, navigate, tokens?.refreshToken]);

  const handleLogoutAll = useCallback(async () => {
    setActiveAuthAction('logoutAll');
    clearFeedback();
    try {
      await authApi.logoutAll();
      setMessage('Logged out all devices.');
      appendTerminalEntry('Logged out all devices.');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to logout all devices'));
    } finally {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [appendTerminalEntry, clearFeedback, clearSession, navigate]);

  const handleFocusCodeRange = useCallback((startLine: number, endLine: number | null, coverageTone: CoverageTone) => {
    setCodeFocusRequest((previous) => ({
      startLine,
      endLine,
      coverageTone,
      requestKey: (previous?.requestKey ?? 0) + 1,
    }));
  }, []);

  const handleSetCodeCoverageDecorations = useCallback((decorations: CodeCoverageDecoration[]) => {
    setCodeCoverageDecorations(decorations);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((previous) => !previous);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setIsPanelCollapsed((previous) => !previous);
  }, []);

  const openCommandPalette = useCallback(() => {
    setContextMenu(null);
    setInputDialog(null);
    setIsCommandPaletteOpen(true);
    setCommandQuery('');
    setCommandCursor(0);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    setCommandQuery('');
  }, []);

  const commandDefinitions = useMemo<PaletteCommand[]>(() => {
    return [
      {
        id: 'palette',
        label: 'Show Command Palette',
        shortcut: 'Ctrl+Shift+P',
        keywords: 'command palette quick open',
        run: openCommandPalette,
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        shortcut: 'Ctrl+B',
        keywords: 'explorer sidebar show hide',
        run: toggleSidebar,
      },
      {
        id: 'toggle-panel',
        label: 'Toggle Bottom Panel',
        shortcut: 'Ctrl+`',
        keywords: 'terminal problems panel',
        run: toggleBottomPanel,
      },
      {
        id: 'toggle-tools',
        label: 'Toggle Right Tool Panel',
        shortcut: '',
        keywords: 'analysis coverage ai right panel sidebar tools',
        run: toggleToolPanel,
      },
      {
        id: 'save',
        label: 'Save Active Tab',
        shortcut: 'Ctrl+S',
        keywords: 'save file',
        run: handleSaveActive,
      },
      {
        id: 'save-all',
        label: 'Save All Tabs',
        shortcut: 'Ctrl+Shift+S',
        keywords: 'save all tabs',
        run: handleSaveAll,
      },
      {
        id: 'close-tab',
        label: 'Close Active Tab',
        shortcut: 'Ctrl+W',
        keywords: 'close tab editor',
        run: () => {
          if (selectedFilePath) {
            handleCloseTab(selectedFilePath);
          }
        },
      },
      {
        id: 'rename',
        label: 'Rename Selected Item',
        shortcut: '',
        keywords: 'rename explorer item',
        run: openRenameDialog,
      },
      {
        id: 'collapse-all',
        label: 'Collapse All Folders',
        shortcut: '',
        keywords: 'explorer collapse folder tree',
        run: handleCollapseAllFolders,
      },
      {
        id: 'open-analysis-tab',
        label: 'Open Analysis Sidebar Tab',
        shortcut: '',
        keywords: 'analysis parse java function cfg sidebar',
        run: () => openToolTab('analysis'),
      },
      {
        id: 'open-coverage-tab',
        label: 'Open Coverage Sidebar Tab',
        shortcut: '',
        keywords: 'coverage run test overlay sidebar',
        run: () => openToolTab('coverage'),
      },
      {
        id: 'open-ai-tab',
        label: 'Open AI Suggest Sidebar Tab',
        shortcut: '',
        keywords: 'ai suggest tests sidebar',
        run: () => openToolTab('ai'),
      },
      {
        id: 'maximize-panel',
        label: 'Toggle Panel Maximize',
        shortcut: '',
        keywords: 'maximize panel terminal problems',
        run: () => {
          setIsPanelCollapsed(false);
          setIsPanelMaximized((previous) => !previous);
        },
      },
      {
        id: 'open-import',
        label: 'Import Workspace',
        shortcut: 'Ctrl+N',
        keywords: 'import github folder workspace',
        run: () => setIsImportModalOpen(true),
      },
      {
        id: 'refresh-workspaces',
        label: 'Refresh Workspaces',
        shortcut: '',
        keywords: 'reload workspace list',
        run: () => {
          void loadWorkspaces();
        },
      },
      {
        id: 'go-workspaces',
        label: 'Back to Workspace List',
        shortcut: '',
        keywords: 'workspace list back',
        run: handleBackToProjects,
      },
      {
        id: 'refresh-session',
        label: 'Refresh Session',
        shortcut: '',
        keywords: 'auth token refresh',
        run: () => {
          void handleRefreshToken();
        },
      },
      {
        id: 'logout',
        label: 'Logout',
        shortcut: '',
        keywords: 'logout auth',
        run: () => {
          void handleLogout();
        },
      },
      {
        id: 'logout-all',
        label: 'Logout All Devices',
        shortcut: '',
        keywords: 'logout all sessions',
        run: () => {
          void handleLogoutAll();
        },
      },
    ];
  }, [
    handleBackToProjects,
    handleCloseTab,
    handleCollapseAllFolders,
    handleLogout,
    handleLogoutAll,
    handleRefreshToken,
    handleSaveActive,
    handleSaveAll,
    loadWorkspaces,
    openToolTab,
    openCommandPalette,
    openRenameDialog,
    selectedFilePath,
    toggleBottomPanel,
    toggleToolPanel,
    toggleSidebar,
  ]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return commandDefinitions;
    }

    return commandDefinitions.filter((command) => {
      const haystack = `${command.label} ${command.shortcut} ${command.keywords}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [commandDefinitions, commandQuery]);

  const executeCommand = useCallback(
    (command: PaletteCommand | undefined) => {
      if (!command) {
        return;
      }
      command.run();
      closeCommandPalette();
    },
    [closeCommandPalette],
  );

  const isTabModified = useCallback(
    (path: string): boolean => {
      const draft = draftContentByPath[path] ?? '';
      const saved = savedContentByPath[path] ?? '';
      return draft !== saved;
    },
    [draftContentByPath, savedContentByPath],
  );

  const showContextMenu = useCallback((event: ReactMouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    const menuWidth = 220;
    const menuHeight = Math.max(140, items.length * 28);
    const nextX = clamp(event.clientX, 8, window.innerWidth - menuWidth - 8);
    const nextY = clamp(event.clientY, 38, window.innerHeight - menuHeight - 8);
    setContextMenu({
      x: nextX,
      y: nextY,
      items,
    });
  }, []);

  const openTreeContextMenu = useCallback(
    (event: ReactMouseEvent, node: ExplorerNode) => {
      setSelectedExplorerPath(node.path);

      const items: ContextMenuItem[] = [
        {
          id: 'import-workspace',
          label: 'Import Workspace',
          shortcut: 'Ctrl+N',
          action: () => setIsImportModalOpen(true),
        },
        {
          id: 'rename',
          label: 'Rename',
          action: () => openInputDialog('rename', node.path),
        },
        {
          id: 'sep-1',
          separator: true,
        },
        {
          id: 'collapse',
          label: 'Collapse All',
          action: handleCollapseAllFolders,
        },
      ];

      if (node.type === 'file') {
        items.splice(2, 0, {
          id: 'close-tab',
          label: 'Close Tab',
          shortcut: 'Ctrl+W',
          action: () => handleCloseTab(node.path),
        });
      }

      showContextMenu(event, items);
    },
    [handleCloseTab, handleCollapseAllFolders, openInputDialog, showContextMenu],
  );

  const openEditorContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const items: ContextMenuItem[] = [
        {
          id: 'save',
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: handleSaveActive,
        },
        {
          id: 'save-all',
          label: 'Save All',
          shortcut: 'Ctrl+Shift+S',
          action: handleSaveAll,
        },
        {
          id: 'sep-1',
          separator: true,
        },
        {
          id: 'toggle-panel',
          label: 'Toggle Panel',
          shortcut: 'Ctrl+`',
          action: toggleBottomPanel,
        },
        {
          id: 'close-tab',
          label: 'Close Active Tab',
          shortcut: 'Ctrl+W',
          disabled: !selectedFilePath,
          action: () => {
            if (selectedFilePath) {
              handleCloseTab(selectedFilePath);
            }
          },
        },
      ];
      showContextMenu(event, items);
    },
    [handleCloseTab, handleSaveActive, handleSaveAll, selectedFilePath, showContextMenu, toggleBottomPanel],
  );

  const renderExplorerBranch = useCallback(
    (nodes: ExplorerNode[], depth: number): JSX.Element[] => {
      return nodes.map((node) => {
        const isFolder = node.type === 'folder';
        const isExpanded = expandedFolders[node.path] ?? depth < 1;
        const isSelected = selectedExplorerPath === node.path || selectedFilePath === node.path;
        const fileIcon = isFolder ? null : createFileIcon(node.name, node.language);

        return (
          <div key={node.path} className="ide-tree-node-wrap">
            <div
              ref={(element) => {
                treeItemRefs.current[node.path] = element;
              }}
              className={`ide-tree-node ${isSelected ? 'active' : ''}`}
              onContextMenu={(event) => openTreeContextMenu(event, node)}
            >
              <button
                type="button"
                className="ide-tree-node-button"
                style={{ paddingLeft: `${10 + depth * 14}px` }}
                onClick={() => {
                  setSelectedExplorerPath(node.path);
                  if (isFolder) {
                    handleToggleFolder(node.path);
                    return;
                  }

                  if (node.isVirtual) {
                    handleOpenVirtualFile(node.path);
                    return;
                  }

                  void handleOpenFile(node.path);
                }}
              >
                <span className="ide-tree-chevron" aria-hidden="true">
                  {isFolder ? (isExpanded ? '▾' : '▸') : ''}
                </span>
                {isFolder ? (
                  <span className="ide-tree-folder-icon" aria-hidden="true">
                    {isExpanded ? '📂' : '📁'}
                  </span>
                ) : (
                  <span className={`ide-tree-file-icon ${fileIcon ? `tone-${fileIcon.tone}` : ''}`} aria-hidden="true">
                    {fileIcon?.text ?? 'TXT'}
                  </span>
                )}
                <span className="ide-tree-label" title={node.path}>
                  {node.name}
                </span>
                {node.isVirtual && <span className="ide-tree-virtual-tag">V</span>}
              </button>
            </div>

            {isFolder && isExpanded && node.children.length > 0 && (
              <div className="ide-tree-children">{renderExplorerBranch(node.children, depth + 1)}</div>
            )}
          </div>
        );
      });
    },
    [expandedFolders, handleOpenFile, handleOpenVirtualFile, handleToggleFolder, openTreeContextMenu, selectedExplorerPath, selectedFilePath],
  );

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedProjectId(null);
      setWorkspaceTree(null);
      clearWorkbenchState();
      return;
    }

    const exists = selectedProjectId !== null && workspaces.some((item) => item.projectId === selectedProjectId);
    if (!exists) {
      setSelectedProjectId(null);
      setWorkspaceTree(null);
      clearWorkbenchState();
    }
  }, [clearWorkbenchState, selectedProjectId, workspaces]);

  useEffect(() => {
    if (selectedProjectId === null) {
      return;
    }
    void loadTree(selectedProjectId);
  }, [loadTree, selectedProjectId]);

  useEffect(() => {
    if (!workspaceTree) {
      setExplorerNodes([]);
      setExpandedFolders({});
      return;
    }

    const nextTree = workspaceTree.nodes.map(toExplorerNode);
    setExplorerNodes(nextTree);
    const initialExpandedState: Record<string, boolean> = {};
    collectFolderPaths(nextTree).forEach((path) => {
      initialExpandedState[path] = true;
    });
    setExpandedFolders(initialExpandedState);
    setSelectedExplorerPath(null);
  }, [workspaceTree]);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      commandInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (filteredCommands.length === 0) {
      if (commandCursor !== 0) {
        setCommandCursor(0);
      }
      return;
    }

    if (commandCursor > filteredCommands.length - 1) {
      setCommandCursor(filteredCommands.length - 1);
    }
  }, [commandCursor, filteredCommands.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.ctrlKey || event.metaKey;

      if (hasModifier && event.shiftKey && key === 'p') {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (isCommandPaletteOpen) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setCommandCursor((previous) => {
            if (filteredCommands.length === 0) {
              return 0;
            }
            return (previous + 1) % filteredCommands.length;
          });
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setCommandCursor((previous) => {
            if (filteredCommands.length === 0) {
              return 0;
            }
            return previous === 0 ? filteredCommands.length - 1 : previous - 1;
          });
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          executeCommand(filteredCommands[commandCursor]);
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          closeCommandPalette();
          return;
        }
      }

      if (event.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }

        if (inputDialog) {
          setInputDialog(null);
          return;
        }
      }

      if (!hasModifier) {
        return;
      }

      if (!event.shiftKey && key === 'b') {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (!event.shiftKey && event.code === 'Backquote') {
        event.preventDefault();
        toggleBottomPanel();
        return;
      }

      if (key === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          handleSaveAll();
        } else {
          handleSaveActive();
        }
        return;
      }

      if (!event.shiftKey && key === 'w') {
        event.preventDefault();
        if (selectedFilePath) {
          handleCloseTab(selectedFilePath);
        }
        return;
      }

      if (!event.shiftKey && key === 'n') {
        event.preventDefault();
        setIsImportModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    closeCommandPalette,
    commandCursor,
    contextMenu,
    executeCommand,
    filteredCommands,
    handleCloseTab,
    handleSaveActive,
    handleSaveAll,
    inputDialog,
    isCommandPaletteOpen,
    openCommandPalette,
    selectedFilePath,
    toggleBottomPanel,
    toggleSidebar,
  ]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => {
      setContextMenu(null);
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const cursor = dragState.kind === 'panel' ? 'row-resize' : 'col-resize';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: MouseEvent) => {
      if (dragState.kind === 'sidebar') {
        const nextWidth = clamp(
          dragState.startSize + (event.clientX - dragState.startPointer),
          SIDEBAR_MIN_WIDTH,
          SIDEBAR_MAX_WIDTH,
        );
        setSidebarWidth(nextWidth);
        return;
      }

      if (dragState.kind === 'tool-panel') {
        const nextWidth = clamp(
          dragState.startSize + (dragState.startPointer - event.clientX),
          TOOL_PANEL_MIN_WIDTH,
          TOOL_PANEL_MAX_WIDTH,
        );
        setToolPanelWidth(nextWidth);
        return;
      }

      const nextPanelHeight = clamp(
        dragState.startSize + (dragState.startPointer - event.clientY),
        PANEL_MIN_HEIGHT,
        Math.floor(window.innerHeight * PANEL_MAX_HEIGHT_RATIO),
      );
      setPanelHeight(nextPanelHeight);
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [dragState]);

  const statusBranch = activeWorkspace ? activeWorkspace.name.toLowerCase().replace(/\s+/g, '-') : 'main';
  const statusLanguage = selectedFileContent?.language ?? 'PLAINTEXT';

  return (
    <main className="workspace-page workspace-ide">
      <DeleteWorkspaceModal
        candidate={deleteCandidate}
        deletingProjectId={deletingProjectId}
        onClose={handleCloseDeleteModal}
        onConfirm={handleDeleteWorkspace}
      />

      <ImportWorkspaceModal
        isOpen={isImportModalOpen}
        activeImportAction={activeImportAction}
        repoUrl={repoUrl}
        onRepoUrlChange={setRepoUrl}
        onImportGithub={handleImportGithub}
        folderInputRef={handleFolderInputRef}
        onFolderChange={handleFolderChange}
        selectedFolderName={selectedFolderName}
        folderFilesCount={folderFiles.length}
        zipWorkspaceName={zipWorkspaceName}
        onZipWorkspaceNameChange={setZipWorkspaceName}
        onImportZip={handleImportZip}
        onClose={() => setIsImportModalOpen(false)}
      />

      <header className="ide-title-bar">
        <div className="ide-title-left">
          <button type="button" className="ide-title-menu" aria-label="Toggle sidebar" onClick={toggleSidebar}>
            ☰
          </button>
          <span className="ide-title-app">SAM Editor</span>
        </div>

        <button type="button" className="ide-title-search" onClick={openCommandPalette} title="Open command palette">
          Search files, commands, symbols (Ctrl+Shift+P)
        </button>

        <div className="ide-title-right">
          <span className="ide-title-profile">{isProfileLoading ? 'Loading profile...' : profile?.email ?? 'Authenticated user'}</span>
          <button
            type="button"
            className="ide-window-control"
            onClick={() => setIsImportModalOpen(true)}
            title="Import workspace"
          >
            Import
          </button>
        </div>
      </header>

      <section className={`ide-main-content ${activityView === 'dashboard' ? 'dashboard-fullscreen' : ''}`}>
        <aside className="ide-activity-bar" aria-label="Primary activity bar">
          <button
            type="button"
            className={`ide-activity-button ${activityView === 'explorer' ? 'active' : ''}`}
            onClick={() => openActivityView('explorer')}
            title="Explorer"
          >
            📁
          </button>
          <button
            type="button"
            className={`ide-activity-button ${activityView === 'search' ? 'active' : ''}`}
            onClick={() => openActivityView('search')}
            title="Search"
          >
            🔎
          </button>
          <button
            type="button"
            className={`ide-activity-button ${activityView === 'dashboard' ? 'active' : ''}`}
            onClick={() => openActivityView('dashboard')}
            title="Dashboard"
          >
            📊
          </button>
          <button
            type="button"
            className={`ide-activity-button ${activityView === 'account' ? 'active' : ''}`}
            onClick={() => openActivityView('account')}
            title="Account"
          >
            ⚙
          </button>
        </aside>

        {activityView === 'dashboard' ? (
          <div className="ide-dashboard-fullscreen">
            <div className="ide-dashboard-header">
              <span className="ide-dashboard-title">📊 Dashboard</span>
            </div>
            <DashboardPanel />
          </div>
        ) : (
          <>
            {!isSidebarCollapsed && (
              <aside className="ide-sidebar" style={{ width: `${sidebarWidth}px` }}>
                <header className="ide-sidebar-header">
                  <span className="ide-sidebar-title">{sidebarTitle}</span>
                  <div className="ide-sidebar-actions">
                    <button type="button" className="ide-icon-button" title="Import Workspace" onClick={() => setIsImportModalOpen(true)}>
                      ⤓
                    </button>
                    {(activityView === 'explorer' || activityView === 'search') && selectedProjectId !== null && (
                      <button type="button" className="ide-icon-button" title="Collapse all" onClick={handleCollapseAllFolders}>
                        ⇱
                      </button>
                    )}
                    {(activityView === 'explorer' || activityView === 'search') && selectedProjectId !== null && (
                      <button type="button" className="ide-icon-button" title="Workspace list" onClick={handleBackToProjects}>
                        ↩
                      </button>
                    )}
                  </div>
                </header>

                {activityView === 'search' ? (
                  <div className="ide-sidebar-search-panel">
                    <div className="ide-sidebar-hint">Type to filter explorer results</div>
                    <input
                      value={sidebarQuery}
                      onChange={(event) => setSidebarQuery(event.target.value)}
                      className="ide-input"
                      placeholder="Search in explorer"
                    />
                  </div>
                ) : activityView === 'account' ? (
                  <div className="ide-account-panel">
                    <div className="ide-account-email">{profile?.email ?? 'Authenticated user'}</div>
                    <button
                      type="button"
                      className="ide-secondary-button"
                      onClick={() => {
                        void handleRefreshToken();
                      }}
                      disabled={activeAuthAction !== null}
                    >
                      {activeAuthAction === 'refresh' ? 'Refreshing...' : 'Refresh Session'}
                    </button>
                    <button
                      type="button"
                      className="ide-secondary-button"
                      onClick={() => {
                        void handleLogout();
                      }}
                      disabled={activeAuthAction !== null}
                    >
                      {activeAuthAction === 'logout' ? 'Logging out...' : 'Logout'}
                    </button>
                    <button
                      type="button"
                      className="ide-secondary-button danger"
                      onClick={() => {
                        void handleLogoutAll();
                      }}
                      disabled={activeAuthAction !== null}
                    >
                      {activeAuthAction === 'logoutAll' ? 'Logging out...' : 'Logout All'}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="ide-input ide-sidebar-filter"
                      placeholder={selectedProjectId === null ? 'Find workspace...' : 'Filter files...'}
                      value={sidebarQuery}
                      onChange={(event) => setSidebarQuery(event.target.value)}
                    />

                    {selectedProjectId === null ? (
                      <div className="ide-workspace-list-wrapper">
                        <WorkspaceList
                          items={workspaces}
                          selectedProjectId={selectedProjectId}
                          onSelect={handleSelectWorkspace}
                          onDelete={handleRequestDeleteWorkspace}
                          deletingProjectId={deletingProjectId}
                          isLoading={isLoadingWorkspaces}
                        />
                      </div>
                    ) : (
                      <div className="ide-tree-shell">
                        {isLoadingTree && <div className="ide-tree-empty">Loading workspace tree...</div>}
                        {!isLoadingTree && visibleExplorerNodes.length === 0 && (
                          <div className="ide-tree-empty">
                            {explorerNodes.length === 0 ? 'No files in workspace.' : 'No file matched your filter.'}
                          </div>
                        )}
                        {!isLoadingTree && visibleExplorerNodes.length > 0 && renderExplorerBranch(visibleExplorerNodes, 0)}
                      </div>
                    )}
                  </>
                )}
              </aside>
            )}

            {!isSidebarCollapsed && (
              <div
                className="ide-sidebar-resize"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDragState({
                    kind: 'sidebar',
                    startPointer: event.clientX,
                    startSize: sidebarWidth,
                  });
                }}
              />
            )}

            <section className="ide-editor-container" onContextMenu={openEditorContextMenu}>
              <header className="ide-tab-bar">
                <div className="ide-tab-list">
                  {openTabs.map((path) => {
                    const isActive = path === selectedFilePath;
                    const modified = isTabModified(path);
                    return (
                      <button
                        type="button"
                        key={path}
                        className={`ide-tab ${isActive ? 'active' : ''}`}
                        onClick={() => handleActivateTab(path)}
                      >
                        <span className="ide-tab-title" title={path}>
                          {resolveTabTitle(path)}
                        </span>
                        {modified && <span className="ide-tab-modified" aria-hidden="true" />}
                        <span
                          className="ide-tab-close"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleCloseTab(path);
                          }}
                        >
                          ×
                        </span>
                      </button>
                    );
                  })}

                  {openTabs.length === 0 && <div className="ide-tab-empty">No file opened</div>}
                </div>

                <div className="ide-tab-actions">
                  <button type="button" className="ide-icon-button" onClick={handleSaveActive} title="Save (Ctrl+S)">
                    💾
                  </button>
                  <button
                    type="button"
                    className="ide-icon-button"
                    onClick={() => openToolTab('analysis')}
                    title="Open right tool tab"
                  >
                    📊
                  </button>
                </div>
              </header>

              <div className="ide-editor-region">
                {selectedFilePath ? (
                  <CodeViewer
                    file={activeEditorFile}
                    isLoading={isLoadingFile}
                    focusRequest={codeFocusRequest}
                    coverageDecorations={codeCoverageDecorations}
                    onContentChange={handleEditorContentChange}
                    onCursorChange={(line, column) => {
                      setCursorLine(line);
                      setCursorColumn(column);
                    }}
                  />
                ) : (
                  <div className="ide-editor-empty-state">
                    <div className="ide-empty-logo">SAM</div>
                    <h2>Welcome to SAM Editor Workbench</h2>
                    <p>
                      VS Code style layout with explorer on the left, code editor center, and analysis/coverage/AI tools on the right.
                    </p>
                    <div className="ide-shortcut-grid">
                      <button type="button" className="ide-shortcut-card" onClick={openCommandPalette}>
                        <span>Command Palette</span>
                        <strong>Ctrl+Shift+P</strong>
                      </button>
                      <button type="button" className="ide-shortcut-card" onClick={toggleSidebar}>
                        <span>Toggle Sidebar</span>
                        <strong>Ctrl+B</strong>
                      </button>
                      <button type="button" className="ide-shortcut-card" onClick={toggleBottomPanel}>
                        <span>Toggle Panel</span>
                        <strong>Ctrl+`</strong>
                      </button>
                      <button
                        type="button"
                        className="ide-shortcut-card"
                        onClick={() => openToolTab('analysis')}
                      >
                        <span>Analysis / Coverage / AI</span>
                        <strong>Right Tool Tabs</strong>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!isPanelCollapsed && (
                <div
                  className="ide-panel-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setIsPanelMaximized(false);
                    setDragState({
                      kind: 'panel',
                      startPointer: event.clientY,
                      startSize: panelHeight,
                    });
                  }}
                />
              )}

              {!isPanelCollapsed && (
                <section
                  className={`ide-bottom-panel ${isPanelMaximized ? 'maximized' : ''}`}
                  style={isPanelMaximized ? { height: '70vh' } : { height: `${panelHeight}px` }}
                >
                  <header className="ide-panel-header">
                    <div className="ide-panel-tabs">
                      <button
                        type="button"
                        className={`ide-panel-tab ${panelTab === 'terminal' ? 'active' : ''}`}
                        onClick={() => setPanelTab('terminal')}
                      >
                        TERMINAL
                      </button>
                      <button
                        type="button"
                        className={`ide-panel-tab ${panelTab === 'problems' ? 'active' : ''}`}
                        onClick={() => setPanelTab('problems')}
                      >
                        PROBLEMS
                      </button>
                    </div>

                    <div className="ide-panel-actions">
                      <button
                        type="button"
                        className="ide-icon-button"
                        onClick={() => {
                          setIsPanelMaximized((previous) => !previous);
                        }}
                        title={isPanelMaximized ? 'Restore panel' : 'Maximize panel'}
                      >
                        {isPanelMaximized ? '🗗' : '🗖'}
                      </button>
                      <button type="button" className="ide-icon-button" onClick={toggleBottomPanel} title="Close panel">
                        ✕
                      </button>
                    </div>
                  </header>

                  <div className="ide-panel-body">
                    {panelTab === 'terminal' && (
                      <div className="ide-terminal-output">
                        {terminalEntries.map((entry) => (
                          <div key={entry} className="ide-terminal-line">
                            {entry}
                          </div>
                        ))}
                      </div>
                    )}

                    {panelTab === 'problems' && (
                      <div className="ide-problems-output">
                        {error ? (
                          <div className="ide-problem-item">Error: {error}</div>
                        ) : (
                          <div className="ide-problem-item muted">No active diagnostics.</div>
                        )}
                        {message && <div className="ide-problem-item">Info: {message}</div>}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </section>

            {!isToolPanelCollapsed && (
              <div
                className="ide-tool-resize"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDragState({
                    kind: 'tool-panel',
                    startPointer: event.clientX,
                    startSize: toolPanelWidth,
                  });
                }}
              />
            )}

            <aside
              className={`ide-tool-sidebar ${isToolPanelCollapsed ? 'collapsed' : ''}`}
              style={!isToolPanelCollapsed ? { width: `${toolPanelWidth}px` } : undefined}
            >
              <div className="ide-tool-rail" aria-label="Analysis tools">
                <button
                  type="button"
                  className={`ide-tool-rail-button tool-analysis ${activeToolTab === 'analysis' ? 'active' : ''}`}
                  title="Analysis"
                  aria-label="Analysis"
                  onClick={() => openToolTab('analysis')}
                >
                  <span aria-hidden="true">📊</span>
                </button>
                <button
                  type="button"
                  className={`ide-tool-rail-button tool-coverage ${activeToolTab === 'coverage' ? 'active' : ''}`}
                  title="Coverage"
                  aria-label="Coverage"
                  onClick={() => openToolTab('coverage')}
                >
                  <span aria-hidden="true">🛡️</span>
                </button>
                <button
                  type="button"
                  className={`ide-tool-rail-button tool-ai ${activeToolTab === 'ai' ? 'active' : ''}`}
                  title="AI Suggest"
                  aria-label="AI Suggest"
                  onClick={() => openToolTab('ai')}
                >
                  <span aria-hidden="true">✨</span>
                </button>
                <button
                  type="button"
                  className="ide-tool-rail-button tool-toggle"
                  title={isToolPanelCollapsed ? 'Open tool panel' : 'Collapse tool panel'}
                  onClick={toggleToolPanel}
                >
                  {isToolPanelCollapsed ? '>' : '<'}
                </button>
              </div>

              {!isToolPanelCollapsed && (
                <div className="ide-tool-content">
                  <header className="ide-tool-header">
                    <span className="ide-tool-title">{activeToolTitle}</span>
                    <button type="button" className="ide-icon-button" title="Collapse tool panel" onClick={toggleToolPanel}>
                      ✕
                    </button>
                  </header>
                  <div className="ide-tool-body">
                    {selectedProjectId === null ? (
                      <div className="ide-tree-empty">Select a workspace and open a Java file to use this tool.</div>
                    ) : (
                      <AnalysisPanel
                        projectId={selectedProjectId}
                        selectedFilePath={analysisSelectedFilePath}
                        file={analysisSelectedFile}
                        isFileLoading={isLoadingFile}
                        onFocusCodeRange={handleFocusCodeRange}
                        onSetCodeCoverageDecorations={handleSetCodeCoverageDecorations}
                        toolView={activeToolTab}
                        compact
                      />
                    )}
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </section>

      <footer className="ide-status-bar">
        <div className="ide-status-left">
          <span className="ide-status-item">⑂ {statusBranch || 'main'}</span>
          <span className="ide-status-item">Problems: {error ? 1 : 0}</span>
          <span className="ide-status-item" title={message || undefined}>
            {error ? 'Error state' : message || 'Ready'}
          </span>
        </div>

        <div className="ide-status-right">
          <span className="ide-status-item">Ln {cursorLine}, Col {cursorColumn}</span>
          <span className="ide-status-item">UTF-8</span>
          <span className="ide-status-item">LF</span>
          <span className="ide-status-item">{statusLanguage}</span>
        </div>
      </footer>

      {isCommandPaletteOpen && (
        <div className="ide-command-overlay" onClick={closeCommandPalette}>
          <div className="ide-command-palette" onClick={(event) => event.stopPropagation()}>
            <div className="ide-command-input-row">
              <span className="ide-command-prefix">&gt;</span>
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setCommandCursor(0);
                }}
                className="ide-command-input"
                placeholder="Type a command"
              />
            </div>

            <div className="ide-command-list">
              {filteredCommands.length === 0 && <div className="ide-command-empty">No command matched.</div>}
              {filteredCommands.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  className={`ide-command-item ${index === commandCursor ? 'active' : ''}`}
                  onClick={() => executeCommand(command)}
                >
                  <span>{command.label}</span>
                  {command.shortcut && <span className="ide-command-shortcut">{command.shortcut}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="ide-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          {contextMenu.items.map((item) => {
            if (item.separator) {
              return <div key={item.id} className="ide-context-separator" />;
            }

            return (
              <button
                key={item.id}
                type="button"
                className="ide-context-item"
                disabled={item.disabled}
                onClick={() => {
                  item.action?.();
                  setContextMenu(null);
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="ide-context-shortcut">{item.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}

      {inputDialog && (
        <form
          className="ide-tree-input-dialog"
          style={{ left: `${inputDialog.x}px`, top: `${inputDialog.y}px` }}
          onSubmit={handleSubmitInputDialog}
        >
          <div className="ide-tree-dialog-title">{resolveDialogTitle(inputDialog.mode)}</div>
          <input
            value={inputDialog.value}
            autoFocus
            className="ide-input"
            onChange={(event) => {
              setInputDialog((previous) => {
                if (!previous) {
                  return null;
                }

                return {
                  ...previous,
                  value: event.target.value,
                };
              });
            }}
            placeholder={resolveDialogPlaceholder(inputDialog.mode)}
          />
          <div className="ide-tree-dialog-actions">
            <button type="submit" className="ide-secondary-button">
              OK
            </button>
            <button type="button" className="ide-secondary-button" onClick={() => setInputDialog(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
