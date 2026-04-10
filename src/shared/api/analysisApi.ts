import { httpClient } from './httpClient';
import type { FunctionCfgResponse, JavaFileAnalysisResponse } from './types';

export const analysisApi = {
  analyzeJavaFile(projectId: number, path: string) {
    return httpClient.post<JavaFileAnalysisResponse>(`/workspaces/${projectId}/analysis/java`, null, {
      params: { path },
    });
  },

  getFunctionSummaries(projectId: number, path: string) {
    return httpClient.get<JavaFileAnalysisResponse>(`/workspaces/${projectId}/analysis/functions`, {
      params: { path },
    });
  },

  getFunctionCfg(projectId: number, functionId: number) {
    return httpClient.get<FunctionCfgResponse>(`/workspaces/${projectId}/analysis/functions/${functionId}/cfg`);
  },
};
