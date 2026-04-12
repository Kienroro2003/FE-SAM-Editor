import { httpClient } from './httpClient';
import type { FunctionCfgResponse, JavaFileAnalysisResponse, JavaFileCoverageResponse } from './types';

export const analysisApi = {
  analyzeFile(projectId: number, path: string) {
    return httpClient.post<JavaFileAnalysisResponse>(`/workspaces/${projectId}/analysis/file`, null, {
      params: { path },
    });
  },

  analyzeJavaFile(projectId: number, path: string) {
    return httpClient.post<JavaFileAnalysisResponse>(`/workspaces/${projectId}/analysis/java`, null, {
      params: { path },
    });
  },

  runJavaCoverage(projectId: number, path: string) {
    return httpClient.post<JavaFileCoverageResponse>(`/workspaces/${projectId}/analysis/java/coverage`, null, {
      params: { path },
    });
  },

  getFunctionSummaries(projectId: number, path: string) {
    return httpClient.get<JavaFileAnalysisResponse>(`/workspaces/${projectId}/analysis/functions`, {
      params: { path },
    });
  },

  getFunctionCfg(projectId: number, functionId: number, coverageRunId?: number) {
    return httpClient.get<FunctionCfgResponse>(`/workspaces/${projectId}/analysis/functions/${functionId}/cfg`, {
      params: coverageRunId == null ? undefined : { coverageRunId },
    });
  },
};
