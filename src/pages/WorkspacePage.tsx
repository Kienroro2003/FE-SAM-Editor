import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnalysisPanel } from '../components/workspace/AnalysisPanel';
import { CodeViewer } from '../components/workspace/CodeViewer';
import { DeleteWorkspaceModal } from '../components/workspace/DeleteWorkspaceModal';
import { ImportWorkspaceModal } from '../components/workspace/ImportWorkspaceModal';
import { WorkspaceList } from '../components/workspace/WorkspaceList';
import { WorkspaceTopbar } from '../components/workspace/WorkspaceTopbar';
import { WorkspaceTree } from '../components/workspace/WorkspaceTree';
import { authApi } from '../shared/api/authApi';
import { workspaceApi } from '../shared/api/workspaceApi';
import type {
  ImportGithubWorkspaceResponse,
  WorkspaceFileContentResponse,
  WorkspaceSummaryResponse,
  WorkspaceTreeResponse,
} from '../shared/api/types';
import type { CodeCoverageDecoration, CoverageTone } from '../shared/utils/coverage';
import { useAuth } from '../shared/auth/AuthContext';
import { resolveApiErrorMessage } from '../shared/utils/errors';
import { formatBytes } from '../shared/utils/format';
import { buildZipFromFolderFiles, resolveFolderName } from '../shared/utils/workspaceImport';

type ImportAction = 'github' | 'zip' | null;
type AuthAction = 'refresh' | 'logout' | 'logoutAll' | null;

interface CodeFocusRequest {
  startLine: number;
  endLine: number | null;
  coverageTone: CoverageTone;
  requestKey: number;
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const { tokens, profile, authError, isProfileLoading, clearAuthError, clearSession, setSession } = useAuth();

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
  const [isTopbarCollapsed, setIsTopbarCollapsed] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<WorkspaceSummaryResponse | null>(null);

  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.projectId === selectedProjectId) ?? null,
    [workspaces, selectedProjectId],
  );

  const clearFeedback = useCallback(() => {
    setError('');
    setMessage('');
    clearAuthError();
  }, [clearAuthError]);

  const clearCodeViewerState = useCallback(() => {
    setCodeFocusRequest(null);
    setCodeCoverageDecorations([]);
  }, []);

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

  const loadTree = useCallback(async (projectId: number) => {
    setIsLoadingTree(true);
    setSelectedFilePath(null);
    setSelectedFileContent(null);
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
  }, [clearCodeViewerState]);

  const handleSelectWorkspace = useCallback(
    (projectId: number) => {
      setWorkspaceTree(null);
      setSelectedFilePath(null);
      setSelectedFileContent(null);
      clearCodeViewerState();
      setSelectedProjectId(projectId);
      clearFeedback();
    },
    [clearCodeViewerState, clearFeedback],
  );

  const handleBackToProjects = useCallback(() => {
    setSelectedProjectId(null);
    setWorkspaceTree(null);
    setSelectedFilePath(null);
    setSelectedFileContent(null);
    clearCodeViewerState();
    clearFeedback();
  }, [clearCodeViewerState, clearFeedback]);

  const handleOpenFile = useCallback(
    async (path: string) => {
      if (!selectedProjectId) {
        return;
      }

      setIsLoadingFile(true);
      setSelectedFilePath(path);
      clearCodeViewerState();
      try {
        const response = await workspaceApi.getWorkspaceFileContent(selectedProjectId, path);
        setSelectedFileContent(response.data);
      } catch (err) {
        setSelectedFileContent(null);
        setError(resolveApiErrorMessage(err, 'Unable to load file content'));
      } finally {
        setIsLoadingFile(false);
      }
    },
    [clearCodeViewerState, selectedProjectId],
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

  const handleFolderChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFiles = Array.from(event.target.files ?? []);
      const nextFolderName = resolveFolderName(nextFiles);
      setFolderFiles(nextFiles);
      setSelectedFolderName(nextFolderName);

      if (nextFiles.length > 0 && !nextFolderName) {
        setError('Please choose a folder (not individual files).');
        return;
      }
      setError('');
    },
    [],
  );

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

      setWorkspaces((prev) => prev.filter((workspace) => workspace.projectId !== workspaceToDelete.projectId));
      if (selectedProjectId === workspaceToDelete.projectId) {
        setSelectedProjectId(null);
        setWorkspaceTree(null);
        setSelectedFilePath(null);
        setSelectedFileContent(null);
        clearCodeViewerState();
      }
      setDeleteCandidate(null);
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to delete workspace'));
    } finally {
      setDeletingProjectId(null);
    }
  }, [clearCodeViewerState, clearFeedback, deleteCandidate, selectedProjectId]);

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
      } catch (err) {
        setError(resolveApiErrorMessage(err, 'Unable to import GitHub workspace'));
      } finally {
        setActiveImportAction(null);
      }
    },
    [clearFeedback, loadWorkspaces, repoUrl],
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
      } catch (err) {
        setError(resolveApiErrorMessage(err, 'Unable to import local folder'));
      } finally {
        setActiveImportAction(null);
      }
    },
    [clearFeedback, folderFiles, loadWorkspaces, selectedFolderName, zipWorkspaceName],
  );

  const handleRefreshToken = useCallback(async () => {
    if (!tokens?.refreshToken) {
      setError('No refresh token available. Please login again.');
      return;
    }

    setIsSettingsMenuOpen(false);
    setActiveAuthAction('refresh');
    clearFeedback();
    try {
      const response = await authApi.refreshToken({ refreshToken: tokens.refreshToken });
      setSession(response.data);
      setMessage('Session refreshed successfully.');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to refresh session'));
    } finally {
      setActiveAuthAction(null);
    }
  }, [clearFeedback, setSession, tokens?.refreshToken]);

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
    setIsSettingsMenuOpen(false);
    setActiveAuthAction('logoutAll');
    clearFeedback();
    try {
      await authApi.logoutAll();
      setMessage('Logged out all devices.');
    } catch (err) {
      setError(resolveApiErrorMessage(err, 'Unable to logout all devices'));
    } finally {
      clearSession();
      navigate('/auth', { replace: true });
    }
  }, [clearFeedback, clearSession, navigate]);

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

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedProjectId(null);
      setWorkspaceTree(null);
      setSelectedFilePath(null);
      setSelectedFileContent(null);
      clearCodeViewerState();
      return;
    }

    const exists = selectedProjectId !== null && workspaces.some((item) => item.projectId === selectedProjectId);
    if (!exists) {
      setSelectedProjectId(null);
      setWorkspaceTree(null);
      setSelectedFilePath(null);
      setSelectedFileContent(null);
      clearCodeViewerState();
    }
  }, [clearCodeViewerState, selectedProjectId, workspaces]);

  useEffect(() => {
    if (selectedProjectId === null) {
      return;
    }
    void loadTree(selectedProjectId);
  }, [loadTree, selectedProjectId]);

  useEffect(() => {
    if (!isSettingsMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsSettingsMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSettingsMenuOpen]);

  return (
    <main className={`workspace-page ${isTopbarCollapsed ? 'topbar-collapsed' : ''}`}>
      <WorkspaceTopbar
        profileEmail={profile?.email}
        workspaceCount={workspaces.length}
        activeWorkspaceName={activeWorkspace?.name ?? null}
        isCollapsed={isTopbarCollapsed}
        isProfileLoading={isProfileLoading}
        activeAuthAction={activeAuthAction}
        isSettingsMenuOpen={isSettingsMenuOpen}
        settingsMenuRef={settingsMenuRef}
        onToggleCollapsed={() => {
          setIsSettingsMenuOpen(false);
          setIsTopbarCollapsed((prev) => !prev);
        }}
        onToggleSettingsMenu={() => setIsSettingsMenuOpen((prev) => !prev)}
        onRefreshToken={handleRefreshToken}
        onLogout={handleLogout}
        onLogoutAll={handleLogoutAll}
      />

      {message && <div className="feedback success">{message}</div>}
      {(error || authError) && <div className="feedback error">{error || authError}</div>}

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

      <section className="workspace-grid">
        <aside className="left-panel">
          {selectedProjectId === null ? (
            <div className="panel stretch">
              <div className="panel-header">
                <h2>My Workspaces</h2>
                <button
                  type="button"
                  className="panel-icon-button"
                  onClick={() => setIsImportModalOpen(true)}
                  aria-label="Import folder"
                  title="Import folder"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M10 4a2 2 0 0 1 1.41.59l1 1A2 2 0 0 0 13.83 6H19a2 2 0 0 1 2 2v1H3V6a2 2 0 0 1 2-2h5Zm11 7H3v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7Zm-9 1a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2v-2a1 1 0 0 1 1-1Z"
                    />
                  </svg>
                </button>
              </div>
              <p className="panel-muted panel-description">Chọn project để thay phần này thành workspace tree.</p>
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
            <section className="panel stretch">
              <h2>File Tree {activeWorkspace ? `- ${activeWorkspace.name}` : ''}</h2>
              <p className="panel-muted panel-description">Mở file từ workspace để xem code và chạy phân tích CFG.</p>
              <WorkspaceTree
                nodes={workspaceTree?.nodes ?? []}
                selectedPath={selectedFilePath}
                onSelectFile={handleOpenFile}
                onBackToProjects={handleBackToProjects}
                isLoading={isLoadingTree}
              />
            </section>
          )}
        </aside>

        <section className="middle-panel panel stretch">
          <h2>Code Viewer</h2>
          <p className="panel-muted panel-description">Chỉ đọc, không chỉnh sửa trực tiếp trên trình duyệt.</p>
          <CodeViewer
            file={selectedFileContent}
            isLoading={isLoadingFile}
            focusRequest={codeFocusRequest}
            coverageDecorations={codeCoverageDecorations}
          />
        </section>

        <section className="right-panel panel stretch">
          <AnalysisPanel
            projectId={selectedProjectId}
            selectedFilePath={selectedFilePath}
            file={selectedFileContent}
            isFileLoading={isLoadingFile}
            onFocusCodeRange={handleFocusCodeRange}
            onSetCodeCoverageDecorations={handleSetCodeCoverageDecorations}
          />
        </section>
      </section>
    </main>
  );
}
