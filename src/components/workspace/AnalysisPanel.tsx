import { useCallback, useEffect, useMemo, useState } from 'react';
import { analysisApi } from '../../shared/api/analysisApi';
import type {
  FunctionCfgResponse,
  JavaFileAnalysisResponse,
  WorkspaceFileContentResponse,
} from '../../shared/api/types';
import { resolveApiErrorMessage } from '../../shared/utils/errors';
import { LoadingState } from '../common/LoadingState';
import { CfgGraph } from './CfgGraph';
import { FunctionList } from './FunctionList';

interface AnalysisPanelProps {
  projectId: number | null;
  selectedFilePath: string | null;
  file: WorkspaceFileContentResponse | null;
  isFileLoading: boolean;
  onFocusCodeRange: (startLine: number, endLine: number | null) => void;
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

export function AnalysisPanel({ projectId, selectedFilePath, file, isFileLoading, onFocusCodeRange }: AnalysisPanelProps) {
  const [analysisSummary, setAnalysisSummary] = useState<JavaFileAnalysisResponse | null>(null);
  const [selectedFunctionId, setSelectedFunctionId] = useState<number | null>(null);
  const [selectedFunctionCfg, setSelectedFunctionCfg] = useState<FunctionCfgResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingCfg, setIsLoadingCfg] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);

  useEffect(() => {
    setAnalysisSummary(null);
    setSelectedFunctionId(null);
    setSelectedFunctionCfg(null);
    setAnalysisError('');
    setIsAnalyzing(false);
    setIsLoadingCfg(false);
    setIsGraphExpanded(false);
  }, [projectId, selectedFilePath]);

  const isJavaFile = file?.language === 'JAVA';
  const hasSelectedFile = Boolean(selectedFilePath);
  const activeFunction = useMemo(
    () => analysisSummary?.functions.find((item) => item.functionId === selectedFunctionId) ?? null,
    [analysisSummary, selectedFunctionId],
  );

  const loadFunctionCfg = useCallback(
    async (functionId: number) => {
      if (!projectId) {
        return;
      }

      setSelectedFunctionId(functionId);
      setSelectedFunctionCfg(null);
      setIsLoadingCfg(true);
      setAnalysisError('');

      try {
        const response = await analysisApi.getFunctionCfg(projectId, functionId);
        setSelectedFunctionCfg(response.data);
      } catch (error) {
        setAnalysisError(resolveApiErrorMessage(error, 'Unable to load function CFG'));
      } finally {
        setIsLoadingCfg(false);
      }
    },
    [projectId],
  );

  const handleAnalyze = useCallback(async () => {
    if (!projectId || !selectedFilePath) {
      return;
    }

    setIsAnalyzing(true);
    setIsLoadingCfg(false);
    setAnalysisError('');
    setAnalysisSummary(null);
    setSelectedFunctionId(null);
    setSelectedFunctionCfg(null);

    try {
      const response = await analysisApi.analyzeJavaFile(projectId, selectedFilePath);
      const nextSummary = response.data;
      setAnalysisSummary(nextSummary);

      if (nextSummary.functions.length === 0) {
        return;
      }

      await loadFunctionCfg(nextSummary.functions[0].functionId);
    } catch (error) {
      setAnalysisError(resolveApiErrorMessage(error, 'Unable to analyze file'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadFunctionCfg, projectId, selectedFilePath]);

  const analyzeButtonLabel = analysisSummary ? 'Re-run Analysis' : 'Analyze';

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <div>
          <h2>Analysis</h2>
          <p className="panel-muted panel-description">Parse Java source, inspect methods, and render CFG for one function at a time.</p>
        </div>
        <button type="button" onClick={handleAnalyze} disabled={!projectId || !isJavaFile || isFileLoading || isAnalyzing}>
          {isAnalyzing ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Analyzing...
            </span>
          ) : (
            analyzeButtonLabel
          )}
        </button>
      </div>

      <div className="analysis-file-summary">
        <div className="analysis-file-path" title={selectedFilePath ?? undefined}>
          {selectedFilePath ?? 'No file selected'}
        </div>
        <div className="analysis-status-row">
          <span className={`analysis-pill ${isJavaFile ? 'accent' : ''}`}>{file?.language ?? 'N/A'}</span>
          {analysisSummary && (
            <>
              <span className={`analysis-pill ${analysisSummary.cached ? 'muted' : 'success'}`}>
                {analysisSummary.cached ? 'Cached analysis' : 'Fresh analysis'}
              </span>
              <span className="analysis-pill">{analysisSummary.functions.length} functions</span>
            </>
          )}
        </div>
      </div>

      {analysisError && <div className="feedback error analysis-feedback">{analysisError}</div>}

      {isFileLoading && <LoadingState message="Loading selected file..." className="analysis-loading" />}
      {!isFileLoading && !hasSelectedFile && <div className="analysis-empty-state">Select a file to analyze.</div>}
      {!isFileLoading && hasSelectedFile && file && !isJavaFile && (
        <div className="analysis-empty-state">Analysis currently supports JAVA files only.</div>
      )}

      {!isFileLoading && hasSelectedFile && isJavaFile && (
        <div className={`analysis-body ${isGraphExpanded ? 'graph-expanded' : ''}`}>
          {!isGraphExpanded && (
            <section className="analysis-section">
              <div className="analysis-section-header">
                <h3>Functions</h3>
                {activeFunction && <span className="panel-muted">{formatLineRange(activeFunction.startLine, activeFunction.endLine)}</span>}
              </div>
              {analysisSummary ? (
                <FunctionList
                  functions={analysisSummary.functions}
                  selectedFunctionId={selectedFunctionId}
                  onSelect={(functionId) => void loadFunctionCfg(functionId)}
                  isLoading={isAnalyzing}
                />
              ) : isAnalyzing ? (
                <LoadingState message="Analyzing functions and building summaries..." className="analysis-loading" />
              ) : (
                <div className="analysis-empty-state compact">Run analysis to load method summaries and cyclomatic complexity.</div>
              )}
            </section>
          )}

          <section className={`analysis-section stretch ${isGraphExpanded ? 'expanded' : ''}`}>
            <div className="analysis-section-header">
              <h3>Control Flow Graph</h3>
              <div className="analysis-section-actions">
                {selectedFunctionCfg && <span className="analysis-pill success">CC {selectedFunctionCfg.cyclomaticComplexity}</span>}
                <button
                  type="button"
                  className="analysis-toggle-button"
                  onClick={() => setIsGraphExpanded((previous) => !previous)}
                  disabled={!selectedFunctionCfg && !isAnalyzing && !isLoadingCfg}
                  aria-label={isGraphExpanded ? 'Collapse control flow graph' : 'Expand control flow graph'}
                  title={isGraphExpanded ? 'Collapse control flow graph' : 'Expand control flow graph'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {isGraphExpanded ? (
                      <path
                        fill="currentColor"
                        d="M8 4a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2H8A1 1 0 0 1 7 8V5a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 1 1 0-2h2V5a1 1 0 0 1 1-1ZM8 15a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 1 1 0-2h2v-2a1 1 0 0 1 1-1Z"
                      />
                    ) : (
                      <path
                        fill="currentColor"
                        d="M7 4a1 1 0 0 1 1 1v1.59l2.3-2.3a1 1 0 1 1 1.4 1.42L9.42 8H11a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm10 0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h1.59l-2.3-2.29a1 1 0 0 1 1.42-1.42L16 6.59V5a1 1 0 0 1 1-1ZM6 14a1 1 0 0 1 1 1v1.59l2.3-2.3a1 1 0 0 1 1.4 1.42L8.42 18H10a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm11 0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h1.59l-2.3-2.3a1 1 0 1 1 1.42-1.4L16 16.58V15a1 1 0 0 1 1-1Z"
                      />
                    )}
                  </svg>
                </button>
              </div>
            </div>
            <CfgGraph cfg={selectedFunctionCfg} isLoading={isAnalyzing || isLoadingCfg} onNodeSelect={onFocusCodeRange} />
          </section>
        </div>
      )}
    </div>
  );
}
