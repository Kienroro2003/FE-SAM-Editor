export interface ApiMessage {
  message: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  email: string;
  fullName: string;
}

export interface RegisterRequest {
  email: string;
  fullName: string;
  password: string;
}

export interface VerifyOtpRequest {
  email: string;
  otpCode: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface MeResponse {
  email: string;
  authorities: Array<{ authority: string }>;
}

export interface GithubLoginHintResponse {
  loginUrl: string;
}

export interface ImportGithubWorkspaceRequest {
  repoUrl: string;
}

export interface ImportGithubWorkspaceResponse {
  projectId: number;
  name: string;
  sourceUrl: string;
  totalFiles: number;
  totalSizeBytes: number;
}

export interface WorkspaceSummaryResponse {
  projectId: number;
  name: string;
  sourceType: 'GITHUB' | 'LOCAL_FOLDER' | string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTreeNodeResponse {
  name: string;
  path: string;
  type: 'file' | 'folder' | string;
  language: string | null;
  children?: WorkspaceTreeNodeResponse[];
}

export interface WorkspaceTreeResponse {
  projectId: number;
  projectName: string;
  nodes: WorkspaceTreeNodeResponse[];
}

export interface WorkspaceFileContentResponse {
  projectId: number;
  path: string;
  language: string;
  content: string;
  sizeBytes: number;
}

export interface FunctionAnalysisSummaryResponse {
  functionId: number;
  functionName: string;
  signature: string;
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
}

export interface JavaFileAnalysisResponse {
  projectId: number;
  path: string;
  language: string;
  cached: boolean;
  functions: FunctionAnalysisSummaryResponse[];
}

export interface CoverageFunctionSummaryResponse {
  functionId: number;
  functionName: string;
  signature: string;
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
  coverageStatus: string | null;
  coveredLineCount: number | null;
  missedLineCount: number | null;
  coveredBranchCount: number | null;
  missedBranchCount: number | null;
}

export interface JavaFileCoverageResponse {
  coverageRunId: number | null;
  projectId: number;
  path: string;
  language: string;
  status: string | null;
  exitCode: number | null;
  overlayAvailable: boolean;
  command: string | null;
  stdout: string | null;
  stderr: string | null;
  startedAt: string | null;
  completedAt: string | null;
  functions: CoverageFunctionSummaryResponse[];
}

export interface AiCoverageResult {
  coveredLines: number[];
  uncoveredLines: number[];
  coveredBranches: string[];
  uncoveredBranches: string[];
  coveredFunctions: string[];
  uncoveredFunctions: string[];
  coveragePercentage: number;
}

export interface AiSuggestTestsRequest {
  sourceCode: string;
  testCode: string;
  coverageResult: AiCoverageResult;
  language: string;
}

export interface AnalysisGraphNodeResponse {
  id: string;
  type: string;
  label: string;
  startLine: number | null;
  endLine: number | null;
  coverageStatus: string | null;
  coveredLineCount: number | null;
  missedLineCount: number | null;
  coveredBranchCount: number | null;
  missedBranchCount: number | null;
}

export interface AnalysisGraphEdgeResponse {
  id: string;
  source: string;
  target: string;
  label: string | null;
}

export interface FunctionCfgResponse {
  functionId: number;
  functionName: string;
  signature: string;
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
  entryNodeId: string;
  exitNodeIds: string[];
  nodes: AnalysisGraphNodeResponse[];
  edges: AnalysisGraphEdgeResponse[];
  coverageRunId: number | null;
  coverageStatus: string | null;
  coveredLineCount: number | null;
  missedLineCount: number | null;
  coveredBranchCount: number | null;
  missedBranchCount: number | null;
}

export interface DeleteWorkspaceResponse {
  projectId: number;
  deletedFiles: number;
  message: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
}
