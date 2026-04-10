import { httpClient } from './httpClient';
import type {
  DeleteWorkspaceResponse,
  ImportGithubWorkspaceResponse,
  WorkspaceFileContentResponse,
  WorkspaceSummaryResponse,
  WorkspaceTreeResponse,
} from './types';

export const workspaceApi = {
  importGithub(repoUrl: string) {
    return httpClient.post<ImportGithubWorkspaceResponse>('/workspaces/import/github', { repoUrl });
  },

  importFolder(file: File, workspaceName?: string) {
    const formData = new FormData();
    formData.append('file', file);
    if (workspaceName && workspaceName.trim().length > 0) {
      formData.append('workspaceName', workspaceName.trim());
    }
    return httpClient.post<ImportGithubWorkspaceResponse>('/workspaces/import/folder', formData);
  },

  getMyWorkspaces() {
    return httpClient.get<WorkspaceSummaryResponse[]>('/workspaces');
  },

  getWorkspaceTree(projectId: number) {
    return httpClient.get<WorkspaceTreeResponse>(`/workspaces/${projectId}/tree`);
  },

  getWorkspaceFileContent(projectId: number, path: string) {
    return httpClient.get<WorkspaceFileContentResponse>(`/workspaces/${projectId}/files/content`, {
      params: { path },
    });
  },

  deleteWorkspace(projectId: number) {
    return httpClient.delete<DeleteWorkspaceResponse>(`/workspaces/${projectId}`);
  },
};
