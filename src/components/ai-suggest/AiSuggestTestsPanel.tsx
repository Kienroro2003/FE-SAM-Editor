import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CoverageFunctionSummaryResponse, WorkspaceFileContentResponse } from '../../shared/api/types';
import { useAiSuggestTestsStream } from '../../shared/hooks/useAiSuggestTestsStream';
import { resolveCoverageStatus } from '../../shared/utils/coverage';

interface AiSuggestTestsPanelProps {
  sourceFilePath: string | null;
  sourceFile: WorkspaceFileContentResponse | null;
  coverageFunctions: CoverageFunctionSummaryResponse[];
  disabled: boolean;
  autoSuggestRunId: number | null;
}

function uniqueSorted(numbers: number[]): number[] {
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function mapLanguage(language: string | null | undefined): string {
  if (!language) {
    return 'javascript';
  }

  const normalized = language.trim().toLowerCase();
  if (normalized === 'java') {
    return 'java';
  }
  return normalized;
}

export function AiSuggestTestsPanel({
  sourceFilePath,
  sourceFile,
  coverageFunctions,
  disabled,
  autoSuggestRunId,
}: AiSuggestTestsPanelProps) {
  const { suggestionText, suggestError, isSuggesting, startSuggesting, stopSuggesting } = useAiSuggestTestsStream();
  const lastAutoRunIdRef = useRef<number | null>(null);

  const { uncoveredFunctions, coveredFunctions, uncoveredLines, coveredLines } = useMemo(() => {
    const nextUncoveredFunctions: string[] = [];
    const nextCoveredFunctions: string[] = [];
    const missedLines: number[] = [];
    const hitLines: number[] = [];

    coverageFunctions.forEach((item) => {
      const status = resolveCoverageStatus(item);
      const signature = item.signature?.trim() || item.functionName;

      if (status === 'MISSED' || status === 'PARTIAL') {
        nextUncoveredFunctions.push(signature);
      }
      if (status === 'COVERED' || status === 'PARTIAL') {
        nextCoveredFunctions.push(signature);
      }

      const start = Math.min(item.startLine, item.endLine);
      const end = Math.max(item.startLine, item.endLine);

      if (status === 'MISSED' || status === 'PARTIAL') {
        for (let line = start; line <= end; line += 1) {
          missedLines.push(line);
        }
      }

      if (status === 'COVERED' || status === 'PARTIAL') {
        for (let line = start; line <= end; line += 1) {
          hitLines.push(line);
        }
      }
    });

    return {
      uncoveredFunctions: [...new Set(nextUncoveredFunctions)],
      coveredFunctions: [...new Set(nextCoveredFunctions)],
      uncoveredLines: uniqueSorted(missedLines),
      coveredLines: uniqueSorted(hitLines),
    };
  }, [coverageFunctions]);

  const coveragePercentage = useMemo(() => {
    if (coverageFunctions.length === 0) {
      return 0;
    }

    const total = coverageFunctions.length;
    const covered = coverageFunctions.filter((item) => resolveCoverageStatus(item) === 'COVERED').length;
    return Math.round((covered / total) * 100);
  }, [coverageFunctions]);

  const canSuggest = !disabled && Boolean(sourceFilePath) && Boolean(sourceFile?.content) && coverageFunctions.length > 0;

  const handleSuggest = useCallback(async () => {
    if (!canSuggest || !sourceFile) {
      return;
    }

    await startSuggesting({
      sourceCode: sourceFile.content,
      testCode: '',
      language: mapLanguage(sourceFile.language),
      coverageResult: {
        coveredLines,
        uncoveredLines,
        coveredBranches: [],
        uncoveredBranches: [],
        coveredFunctions,
        uncoveredFunctions,
        coveragePercentage,
      },
    });
  }, [canSuggest, coveredFunctions, coveredLines, coveragePercentage, sourceFile, startSuggesting, uncoveredFunctions, uncoveredLines]);

  useEffect(() => {
    if (!autoSuggestRunId || autoSuggestRunId === lastAutoRunIdRef.current) {
      return;
    }

    lastAutoRunIdRef.current = autoSuggestRunId;
    void handleSuggest();
  }, [autoSuggestRunId, handleSuggest]);

  return (
    <section className="analysis-run-summary">
      <div className="analysis-section-header">
        <h3>AI Suggest Tests</h3>
        {isSuggesting ? (
          <button type="button" className="button-secondary analysis-inline-button" onClick={stopSuggesting}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary analysis-inline-button"
            onClick={() => {
              void handleSuggest();
            }}
            disabled={!canSuggest}
          >
            Generate test suggestion
          </button>
        )}
      </div>

      <div className="analysis-status-row">
        <span className="analysis-pill">{coverageFunctions.length} functions</span>
        <span className="analysis-pill muted">{coveragePercentage}% covered</span>
        <span className="analysis-pill">{uncoveredFunctions.length} needs tests</span>
      </div>

      {!canSuggest && <div className="analysis-empty-state compact">Run coverage on a source file before using AI suggest.</div>}

      {suggestError && <div className="feedback error analysis-feedback">{suggestError}</div>}

      {isSuggesting && <div className="feedback loading">AI is streaming test suggestions...</div>}

      {suggestionText && (
        <div className="analysis-run-details">
          <div className="analysis-run-output-block">
            <div className="analysis-run-output-label">suggested tests</div>
            <pre>{suggestionText}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
