import { useCallback, useEffect, useMemo, useState } from 'react';
import { analysisApi } from '../../shared/api/analysisApi';
import type {
  CoverageFunctionSummaryResponse,
  FunctionAnalysisSummaryResponse,
  FunctionCfgResponse,
  JavaFileAnalysisResponse,
  JavaFileCoverageResponse,
  WorkspaceFileContentResponse,
} from '../../shared/api/types';
import type { CodeCoverageDecoration, CoverageTone } from '../../shared/utils/coverage';
import { isCoverageRunFailed, isCoverageRunSucceeded, toCoverageTone } from '../../shared/utils/coverage';
import { resolveApiErrorMessage } from '../../shared/utils/errors';
import { LoadingState } from '../common/LoadingState';
import { AiSuggestTestsPanel } from '../ai-suggest/AiSuggestTestsPanel';
import { CfgGraph } from './CfgGraph';
import { FunctionList, type FunctionListItem } from './FunctionList';

interface AnalysisPanelProps {
  projectId: number | null;
  selectedFilePath: string | null;
  file: WorkspaceFileContentResponse | null;
  isFileLoading: boolean;
  onFocusCodeRange: (startLine: number, endLine: number | null, coverageTone: CoverageTone) => void;
  onSetCodeCoverageDecorations: (decorations: CodeCoverageDecoration[]) => void;
}

interface LoadFunctionCfgOptions {
  preferredMode: 'plain' | 'coverage';
  coverageRunId?: number | null;
  coverageOverlayAvailable?: boolean;
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function formatRunDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) {
    return null;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  const totalSeconds = Math.round((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function truncateOutput(output: string | null, maxLength = 220): string {
  const normalized = output?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function normalizeAnalysisSummary(summary: JavaFileAnalysisResponse): JavaFileAnalysisResponse {
  return {
    ...summary,
    functions: summary.functions ?? [],
  };
}

function normalizeCoverageFunction(summary: CoverageFunctionSummaryResponse): CoverageFunctionSummaryResponse {
  return {
    ...summary,
    coverageStatus: summary.coverageStatus ?? null,
    coveredLineCount: summary.coveredLineCount ?? null,
    missedLineCount: summary.missedLineCount ?? null,
    coveredBranchCount: summary.coveredBranchCount ?? null,
    missedBranchCount: summary.missedBranchCount ?? null,
  };
}

function normalizeCoverageSummary(summary: JavaFileCoverageResponse): JavaFileCoverageResponse {
  return {
    ...summary,
    coverageRunId: summary.coverageRunId ?? null,
    status: summary.status ?? null,
    exitCode: summary.exitCode ?? null,
    overlayAvailable: summary.overlayAvailable === true,
    command: summary.command ?? null,
    stdout: summary.stdout ?? null,
    stderr: summary.stderr ?? null,
    startedAt: summary.startedAt ?? null,
    completedAt: summary.completedAt ?? null,
    functions: (summary.functions ?? []).map(normalizeCoverageFunction),
  };
}

function normalizeFunctionCfgResponse(cfg: FunctionCfgResponse): FunctionCfgResponse {
  return {
    ...cfg,
    exitNodeIds: cfg.exitNodeIds ?? [],
    nodes: (cfg.nodes ?? []).map((node) => ({
      ...node,
      coverageStatus: node.coverageStatus ?? null,
      coveredLineCount: node.coveredLineCount ?? null,
      missedLineCount: node.missedLineCount ?? null,
      coveredBranchCount: node.coveredBranchCount ?? null,
      missedBranchCount: node.missedBranchCount ?? null,
    })),
    edges: cfg.edges ?? [],
    coverageRunId: cfg.coverageRunId ?? null,
    coverageStatus: cfg.coverageStatus ?? null,
    coveredLineCount: cfg.coveredLineCount ?? null,
    missedLineCount: cfg.missedLineCount ?? null,
    coveredBranchCount: cfg.coveredBranchCount ?? null,
    missedBranchCount: cfg.missedBranchCount ?? null,
  };
}

function toAnalysisFunctionListItem(summary: FunctionAnalysisSummaryResponse): FunctionListItem {
  return {
    functionId: summary.functionId,
    functionName: summary.functionName,
    signature: summary.signature,
    startLine: summary.startLine,
    endLine: summary.endLine,
    cyclomaticComplexity: summary.cyclomaticComplexity,
  };
}

function toCoverageFunctionListItem(summary: CoverageFunctionSummaryResponse): FunctionListItem {
  return {
    functionId: summary.functionId,
    functionName: summary.functionName,
    signature: summary.signature,
    startLine: summary.startLine,
    endLine: summary.endLine,
    cyclomaticComplexity: summary.cyclomaticComplexity,
    coverageStatus: summary.coverageStatus,
    coveredLineCount: summary.coveredLineCount,
    missedLineCount: summary.missedLineCount,
    coveredBranchCount: summary.coveredBranchCount,
    missedBranchCount: summary.missedBranchCount,
  };
}

function resolveCoverageFailureMessage(summary: JavaFileCoverageResponse | null): string {
  if (!summary) {
    return '';
  }

  const stderrPreview = truncateOutput(summary.stderr);
  if (stderrPreview) {
    return stderrPreview;
  }

  if (summary.status === 'TIMED_OUT') {
    return 'Coverage run timed out in the sandbox.';
  }

  return 'Coverage run failed. Open raw output for more details.';
}

function hasCoverageOverlay(summary: JavaFileCoverageResponse | null): boolean {
  return Boolean(summary && summary.coverageRunId != null && summary.overlayAvailable && isCoverageRunSucceeded(summary.status));
}

function isTechnicalNodeType(type: string): boolean {
  return type === 'ENTRY' || type === 'EXIT' || type === 'NOOP';
}

function resolveFunctionFocusTone(item: FunctionListItem, mode: 'analysis' | 'coverage'): CoverageTone {
  if (mode === 'analysis') {
    return 'neutral';
  }

  return toCoverageTone(item);
}

function coverageTonePriority(coverageTone: CoverageTone): number {
  switch (coverageTone) {
    case 'missed':
      return 3;
    case 'partial':
      return 2;
    case 'covered':
      return 1;
    default:
      return 0;
  }
}

function buildCodeCoverageDecorations(cfg: FunctionCfgResponse | null): CodeCoverageDecoration[] {
  if (!cfg) {
    return [];
  }

  const toneByLine = new Map<number, CoverageTone>();

  cfg.nodes.forEach((node) => {
    if (isTechnicalNodeType(node.type) || node.startLine == null || node.endLine == null) {
      return;
    }

    const coverageTone = toCoverageTone(node);
    if (coverageTone === 'neutral') {
      return;
    }

    const startLine = Math.min(node.startLine, node.endLine);
    const endLine = Math.max(node.startLine, node.endLine);

    for (let line = startLine; line <= endLine; line += 1) {
      const currentTone = toneByLine.get(line) ?? 'neutral';
      if (coverageTonePriority(coverageTone) > coverageTonePriority(currentTone)) {
        toneByLine.set(line, coverageTone);
      }
    }
  });

  const orderedLines = [...toneByLine.entries()].sort(([left], [right]) => left - right);
  if (orderedLines.length === 0) {
    return [];
  }

  const decorations: CodeCoverageDecoration[] = [];
  let currentStartLine = orderedLines[0][0];
  let currentEndLine = orderedLines[0][0];
  let currentTone = orderedLines[0][1];

  orderedLines.slice(1).forEach(([line, tone]) => {
    if (line === currentEndLine + 1 && tone === currentTone) {
      currentEndLine = line;
      return;
    }

    decorations.push({
      startLine: currentStartLine,
      endLine: currentEndLine,
      coverageTone: currentTone,
    });

    currentStartLine = line;
    currentEndLine = line;
    currentTone = tone;
  });

  decorations.push({
    startLine: currentStartLine,
    endLine: currentEndLine,
    coverageTone: currentTone,
  });

  return decorations;
}

export function AnalysisPanel({
  projectId,
  selectedFilePath,
  file,
  isFileLoading,
  onFocusCodeRange,
  onSetCodeCoverageDecorations,
}: AnalysisPanelProps) {
  const [analysisSummary, setAnalysisSummary] = useState<JavaFileAnalysisResponse | null>(null);
  const [coverageSummary, setCoverageSummary] = useState<JavaFileCoverageResponse | null>(null);
  const [activeCoverageRunId, setActiveCoverageRunId] = useState<number | null>(null);
  const [selectedFunctionId, setSelectedFunctionId] = useState<number | null>(null);
  const [selectedFunctionCfg, setSelectedFunctionCfg] = useState<FunctionCfgResponse | null>(null);
  const [cfgMode, setCfgMode] = useState<'plain' | 'coverage'>('plain');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRunningCoverage, setIsRunningCoverage] = useState(false);
  const [isLoadingCfg, setIsLoadingCfg] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [graphError, setGraphError] = useState('');
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);
  const [isRawRunDetailsOpen, setIsRawRunDetailsOpen] = useState(false);
  const [autoSuggestRunId, setAutoSuggestRunId] = useState<number | null>(null);

  useEffect(() => {
    setAnalysisSummary(null);
    setCoverageSummary(null);
    setActiveCoverageRunId(null);
    setSelectedFunctionId(null);
    setSelectedFunctionCfg(null);
    setCfgMode('plain');
    setIsAnalyzing(false);
    setIsRunningCoverage(false);
    setIsLoadingCfg(false);
    setPanelError('');
    setGraphError('');
    setIsGraphExpanded(false);
    setIsRawRunDetailsOpen(false);
    setAutoSuggestRunId(null);
  }, [projectId, selectedFilePath]);

  const isJavaFile = file?.language === 'JAVA';
  const hasSelectedFile = Boolean(selectedFilePath);
  const functionListMode = coverageSummary ? 'coverage' : 'analysis';
  const displayedFunctions = useMemo<FunctionListItem[]>(() => {
    if (coverageSummary) {
      return coverageSummary.functions.map(toCoverageFunctionListItem);
    }
    if (analysisSummary) {
      return analysisSummary.functions.map(toAnalysisFunctionListItem);
    }
    return [];
  }, [analysisSummary, coverageSummary]);
  const activeFunction = useMemo(
    () => displayedFunctions.find((item) => item.functionId === selectedFunctionId) ?? null,
    [displayedFunctions, selectedFunctionId],
  );
  const coverageOverlayReady = hasCoverageOverlay(coverageSummary);
  const coverageRunFailed = isCoverageRunFailed(coverageSummary?.status);
  const coverageFailureMessage = resolveCoverageFailureMessage(coverageSummary);
  const hasRawCoverageOutput = Boolean(
    coverageSummary && ((coverageSummary.stdout?.trim().length ?? 0) > 0 || (coverageSummary.stderr?.trim().length ?? 0) > 0),
  );
  const formattedStartedAt = formatTimestamp(coverageSummary?.startedAt ?? null);
  const formattedCompletedAt = formatTimestamp(coverageSummary?.completedAt ?? null);
  const formattedDuration = formatRunDuration(coverageSummary?.startedAt ?? null, coverageSummary?.completedAt ?? null);

  useEffect(() => {
    onSetCodeCoverageDecorations(buildCodeCoverageDecorations(selectedFunctionCfg));
  }, [onSetCodeCoverageDecorations, selectedFunctionCfg]);

  const loadFunctionCfg = useCallback(
    async (functionId: number, options: LoadFunctionCfgOptions) => {
      if (!projectId) {
        return;
      }

      const requestedCoverageRunId = options.coverageRunId ?? activeCoverageRunId;
      const requestedCoverageOverlayAvailable = options.coverageOverlayAvailable ?? coverageOverlayReady;
      const shouldUseCoverageCfg =
        options.preferredMode === 'coverage' && requestedCoverageOverlayAvailable && requestedCoverageRunId != null;
      const resolvedCoverageRunId = shouldUseCoverageCfg ? requestedCoverageRunId : null;

      setSelectedFunctionId(functionId);
      setSelectedFunctionCfg(null);
      setIsLoadingCfg(true);
      setGraphError('');
      setCfgMode(shouldUseCoverageCfg ? 'coverage' : 'plain');

      try {
        const response = await analysisApi.getFunctionCfg(projectId, functionId, resolvedCoverageRunId ?? undefined);
        setSelectedFunctionCfg(normalizeFunctionCfgResponse(response.data));
        setCfgMode(shouldUseCoverageCfg ? 'coverage' : 'plain');
      } catch (error) {
        setSelectedFunctionCfg(null);
        setCfgMode('plain');
        setGraphError(
          resolveApiErrorMessage(error, shouldUseCoverageCfg ? 'Unable to load coverage CFG overlay' : 'Unable to load function CFG'),
        );
      } finally {
        setIsLoadingCfg(false);
      }
    },
    [projectId, activeCoverageRunId, coverageOverlayReady],
  );

  const handleAnalyze = useCallback(async () => {
    if (!projectId || !selectedFilePath) {
      return;
    }

    setIsAnalyzing(true);
    setIsRunningCoverage(false);
    setIsLoadingCfg(false);
    setPanelError('');
    setGraphError('');
    setAnalysisSummary(null);
    setCoverageSummary(null);
    setActiveCoverageRunId(null);
    setSelectedFunctionId(null);
    setSelectedFunctionCfg(null);
    setCfgMode('plain');
    setIsRawRunDetailsOpen(false);
    setAutoSuggestRunId(null);

    try {
      const response = await analysisApi.analyzeJavaFile(projectId, selectedFilePath);
      const nextSummary = normalizeAnalysisSummary(response.data);
      setAnalysisSummary(nextSummary);

      if (nextSummary.functions.length === 0) {
        return;
      }

      const firstFunction = toAnalysisFunctionListItem(nextSummary.functions[0]);
      onFocusCodeRange(firstFunction.startLine, firstFunction.endLine, 'neutral');
      await loadFunctionCfg(firstFunction.functionId, { preferredMode: 'plain' });
    } catch (error) {
      setPanelError(resolveApiErrorMessage(error, 'Unable to analyze file'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadFunctionCfg, onFocusCodeRange, projectId, selectedFilePath]);

  const handleRunCoverage = useCallback(async () => {
    if (!projectId || !selectedFilePath) {
      return;
    }

    setIsRunningCoverage(true);
    setIsAnalyzing(false);
    setIsLoadingCfg(false);
    setPanelError('');
    setGraphError('');
    setAnalysisSummary(null);
    setCoverageSummary(null);
    setActiveCoverageRunId(null);
    setSelectedFunctionId(null);
    setSelectedFunctionCfg(null);
    setCfgMode('plain');
    setIsRawRunDetailsOpen(false);

    try {
      const response = await analysisApi.runJavaCoverage(projectId, selectedFilePath);
      const nextSummary = normalizeCoverageSummary(response.data);
      const nextCoverageRunId = nextSummary.coverageRunId;
      const nextCoverageOverlayReady = hasCoverageOverlay(nextSummary);

      setCoverageSummary(nextSummary);
      setActiveCoverageRunId(nextCoverageRunId);
      setIsRawRunDetailsOpen(isCoverageRunFailed(nextSummary.status));
      setAutoSuggestRunId(Date.now());

      if (nextSummary.functions.length === 0) {
        return;
      }

      const firstFunction = toCoverageFunctionListItem(nextSummary.functions[0]);
      onFocusCodeRange(
        firstFunction.startLine,
        firstFunction.endLine,
        resolveFunctionFocusTone(firstFunction, 'coverage'),
      );
      await loadFunctionCfg(firstFunction.functionId, {
        preferredMode: nextCoverageOverlayReady ? 'coverage' : 'plain',
        coverageRunId: nextCoverageRunId,
        coverageOverlayAvailable: nextCoverageOverlayReady,
      });
    } catch (error) {
      setPanelError(resolveApiErrorMessage(error, 'Unable to run Java coverage'));
    } finally {
      setIsRunningCoverage(false);
    }
  }, [loadFunctionCfg, onFocusCodeRange, projectId, selectedFilePath]);

  const handleSelectFunction = useCallback(
    (functionId: number) => {
      const selectedFunction = displayedFunctions.find((item) => item.functionId === functionId);
      if (selectedFunction) {
        onFocusCodeRange(
          selectedFunction.startLine,
          selectedFunction.endLine,
          resolveFunctionFocusTone(selectedFunction, functionListMode),
        );
      }

      void loadFunctionCfg(functionId, {
        preferredMode: coverageSummary ? 'coverage' : 'plain',
      });
    },
    [coverageSummary, displayedFunctions, functionListMode, loadFunctionCfg, onFocusCodeRange],
  );

  const analyzeButtonLabel = analysisSummary ? 'Re-run Analysis' : 'Analyze';
  const coverageButtonLabel = coverageSummary ? 'Re-run Coverage' : 'Run Coverage';
  const runCoverageDisabled = !projectId || !isJavaFile || isFileLoading || isAnalyzing || isRunningCoverage;
  const isGraphBusy = isAnalyzing || isRunningCoverage || isLoadingCfg;

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <div>
          <h2>Analysis</h2>
          <p className="panel-muted panel-description">
            Parse Java source, run coverage, and inspect CFG with an inline coverage overlay when it is available.
          </p>
        </div>

        <div className="analysis-toolbar-actions">
          <button type="button" onClick={handleAnalyze} disabled={!projectId || !isJavaFile || isFileLoading || isAnalyzing || isRunningCoverage}>
            {isAnalyzing ? (
              <span className="button-loading-content">
                <span className="loading-spinner" aria-hidden="true" />
                Analyzing...
              </span>
            ) : (
              analyzeButtonLabel
            )}
          </button>
          <button type="button" className="button-secondary" onClick={handleRunCoverage} disabled={runCoverageDisabled}>
            {isRunningCoverage ? (
              <span className="button-loading-content">
                <span className="loading-spinner" aria-hidden="true" />
                Running coverage...
              </span>
            ) : (
              coverageButtonLabel
            )}
          </button>
        </div>
      </div>

      <div className="analysis-file-summary">
        <div className="analysis-file-path" title={selectedFilePath ?? undefined}>
          {selectedFilePath ?? 'No file selected'}
        </div>
        <div className="analysis-status-row">
          <span className={`analysis-pill ${isJavaFile ? 'accent' : ''}`}>{file?.language ?? 'N/A'}</span>
          {analysisSummary && (
            <span className={`analysis-pill ${analysisSummary.cached ? 'muted' : 'success'}`}>
              {analysisSummary.cached ? 'Cached analysis' : 'Fresh analysis'}
            </span>
          )}
          {coverageSummary && (
            <span className={`analysis-pill ${isCoverageRunSucceeded(coverageSummary.status) ? 'success' : 'muted'}`}>
              Coverage {coverageSummary.status ?? 'UNKNOWN'}
            </span>
          )}
          {(analysisSummary || coverageSummary) && <span className="analysis-pill">{displayedFunctions.length} functions</span>}
        </div>
      </div>

      {coverageSummary && (
        <section className="analysis-run-summary">
          <div className="analysis-section-header">
            <h3>Run Summary</h3>
            {!coverageRunFailed && hasRawCoverageOutput && (
              <button
                type="button"
                className="button-secondary analysis-inline-button"
                onClick={() => setIsRawRunDetailsOpen((previous) => !previous)}
              >
                {isRawRunDetailsOpen ? 'Hide raw output' : 'Show raw output'}
              </button>
            )}
          </div>

          <div className="analysis-status-row">
            {coverageSummary.coverageRunId != null && <span className="analysis-pill">Run #{coverageSummary.coverageRunId}</span>}
            <span className={`analysis-pill ${isCoverageRunSucceeded(coverageSummary.status) ? 'success' : 'muted'}`}>
              {coverageSummary.status ?? 'UNKNOWN'}
            </span>
            <span className={`analysis-pill ${coverageSummary.overlayAvailable ? 'success' : 'muted'}`}>
              {coverageSummary.overlayAvailable ? 'Overlay available' : 'Overlay unavailable'}
            </span>
            {coverageSummary.exitCode != null && <span className="analysis-pill">Exit {coverageSummary.exitCode}</span>}
          </div>

          {coverageSummary.command && (
            <div className="analysis-run-command-row">
              <span className="panel-muted">Command</span>
              <code className="analysis-run-command">{coverageSummary.command}</code>
            </div>
          )}

          <div className="analysis-run-timeline">
            {formattedStartedAt && <span className="analysis-run-time">Started {formattedStartedAt}</span>}
            {formattedCompletedAt && <span className="analysis-run-time">Completed {formattedCompletedAt}</span>}
            {formattedDuration && <span className="analysis-run-time">Duration {formattedDuration}</span>}
          </div>

          {coverageRunFailed && (
            <div className="feedback error analysis-run-callout">
              <div className="analysis-run-callout-copy">{coverageFailureMessage}</div>
              {hasRawCoverageOutput && (
                <button
                  type="button"
                  className="button-secondary analysis-inline-button"
                  onClick={() => setIsRawRunDetailsOpen((previous) => !previous)}
                >
                  {isRawRunDetailsOpen ? 'Hide raw output' : 'Show raw output'}
                </button>
              )}
            </div>
          )}

          {isRawRunDetailsOpen && hasRawCoverageOutput && (
            <div className="analysis-run-details">
              {coverageSummary.stdout && (
                <div className="analysis-run-output-block">
                  <div className="analysis-run-output-label">stdout</div>
                  <pre>{coverageSummary.stdout}</pre>
                </div>
              )}
              {coverageSummary.stderr && (
                <div className="analysis-run-output-block">
                  <div className="analysis-run-output-label">stderr</div>
                  <pre>{coverageSummary.stderr}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {coverageSummary && (
        <AiSuggestTestsPanel
          sourceFilePath={selectedFilePath}
          sourceFile={file}
          coverageFunctions={coverageSummary.functions}
          disabled={isFileLoading || isRunningCoverage}
          autoSuggestRunId={autoSuggestRunId}
        />
      )}

      {panelError && <div className="feedback error analysis-feedback">{panelError}</div>}

      {isFileLoading && <LoadingState message="Loading selected file..." className="analysis-loading" />}
      {!isFileLoading && !hasSelectedFile && <div className="analysis-empty-state">Select a file to analyze</div>}
      {!isFileLoading && hasSelectedFile && file && !isJavaFile && (
        <div className="analysis-empty-state">Analysis and coverage currently support JAVA files only</div>
      )}

      {!isFileLoading && hasSelectedFile && isJavaFile && (
        <div className={`analysis-body ${isGraphExpanded ? 'graph-expanded' : ''}`}>
          {!isGraphExpanded && (
            <section className="analysis-section">
              <div className="analysis-section-header">
                <h3>Functions</h3>
                {activeFunction && <span className="panel-muted">{formatLineRange(activeFunction.startLine, activeFunction.endLine)}</span>}
              </div>
              {analysisSummary || coverageSummary || isAnalyzing || isRunningCoverage ? (
                <FunctionList
                  functions={displayedFunctions}
                  selectedFunctionId={selectedFunctionId}
                  onSelect={handleSelectFunction}
                  isLoading={isAnalyzing || isRunningCoverage}
                  mode={functionListMode}
                  loadingMessage={
                    isRunningCoverage
                      ? 'Running coverage and collecting function summaries...'
                      : 'Analyzing functions and building summaries...'
                  }
                />
              ) : (
                <div className="analysis-empty-state compact">Run analysis or coverage to inspect methods</div>
              )}
            </section>
          )}

          <section className={`analysis-section stretch ${isGraphExpanded ? 'expanded' : ''}`}>
            <div className="analysis-section-header">
              <h3>Control Flow Graph</h3>
              <div className="analysis-section-actions">
                <span className={`analysis-pill ${cfgMode === 'coverage' ? 'success' : 'muted'}`}>
                  Coverage overlay {cfgMode === 'coverage' ? 'on' : 'off'}
                </span>
                {selectedFunctionCfg && <span className="analysis-pill success">CC {selectedFunctionCfg.cyclomaticComplexity}</span>}
                <button
                  type="button"
                  className="analysis-toggle-button"
                  onClick={() => setIsGraphExpanded((previous) => !previous)}
                  disabled={!selectedFunctionCfg && !isGraphBusy}
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
            <CfgGraph
              cfg={selectedFunctionCfg}
              isLoading={isGraphBusy}
              onNodeSelect={onFocusCodeRange}
              graphError={graphError}
              emptyMessage="Run analysis or coverage and select a function to inspect its CFG."
              loadingMessage={
                isRunningCoverage
                  ? 'Running coverage and loading control flow graph...'
                  : isAnalyzing
                    ? 'Analyzing file and loading control flow graph...'
                    : 'Loading control flow graph...'
              }
            />
            {coverageSummary && !coverageOverlayReady && displayedFunctions.length > 0 && selectedFunctionCfg && (
              <div className="panel-muted analysis-overlay-note">
                Coverage overlay is unavailable for this run, so the graph is showing the plain CFG.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
