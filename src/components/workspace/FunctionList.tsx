import { resolveCoverageStatus } from '../../shared/utils/coverage';
import { LoadingState } from '../common/LoadingState';

export interface FunctionListItem {
  functionId: number;
  functionName: string;
  signature: string;
  startLine: number;
  endLine: number;
  cyclomaticComplexity: number;
  coverageStatus?: string | null;
  coveredLineCount?: number | null;
  missedLineCount?: number | null;
  coveredBranchCount?: number | null;
  missedBranchCount?: number | null;
}

interface FunctionListProps {
  functions: FunctionListItem[];
  selectedFunctionId: number | null;
  onSelect: (functionId: number) => void;
  isLoading: boolean;
  mode: 'analysis' | 'coverage';
  loadingMessage?: string;
  emptyMessage?: string;
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

function formatCounter(label: string, covered: number | null | undefined, missed: number | null | undefined): string {
  return `${label} ${covered ?? 0}/${missed ?? 0}`;
}

function counterTone(
  covered: number | null | undefined,
  missed: number | null | undefined,
): 'covered' | 'missed' | 'partial' | 'neutral' {
  if ((covered ?? 0) > 0 && (missed ?? 0) > 0) {
    return 'partial';
  }
  if ((missed ?? 0) > 0) {
    return 'missed';
  }
  if ((covered ?? 0) > 0) {
    return 'covered';
  }
  return 'neutral';
}

export function FunctionList({
  functions,
  selectedFunctionId,
  onSelect,
  isLoading,
  mode,
  loadingMessage,
  emptyMessage,
}: FunctionListProps) {
  if (isLoading) {
    return <LoadingState message={loadingMessage ?? 'Analyzing functions...'} className="panel-loading" />;
  }

  if (functions.length === 0) {
    return <div className="panel-muted">{emptyMessage ?? 'No analyzable methods were found in this Java file.'}</div>;
  }

  return (
    <div className="analysis-function-list">
      {functions.map((item) => {
        const isActive = item.functionId === selectedFunctionId;
        const coverageTone = resolveCoverageStatus(item);
        const lineCounterTone = counterTone(item.coveredLineCount, item.missedLineCount);
        const branchCounterTone = counterTone(item.coveredBranchCount, item.missedBranchCount);
        return (
          <button
            key={item.functionId}
            type="button"
            className={`analysis-function-item ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(item.functionId)}
          >
            <div className="analysis-function-header">
              <span className="analysis-function-name">{item.functionName}</span>
              <div className="analysis-function-badges">
                {mode === 'coverage' && (
                  <span className={`analysis-pill coverage-status ${coverageTone.toLowerCase()}`}>{coverageTone}</span>
                )}
                <span className="analysis-pill">CC {item.cyclomaticComplexity}</span>
              </div>
            </div>
            <div className="analysis-function-signature">{item.signature}</div>
            <div className="analysis-function-footer">
              <div className="analysis-function-meta">{formatLineRange(item.startLine, item.endLine)}</div>
              {mode === 'coverage' && (
                <div className="analysis-function-counters">
                  <span className={`analysis-counter-pill ${lineCounterTone}`} title="covered lines / missed lines">
                    {formatCounter('Lines', item.coveredLineCount, item.missedLineCount)}
                  </span>
                  <span className={`analysis-counter-pill ${branchCounterTone}`} title="covered branches / missed branches">
                    {formatCounter('Branches', item.coveredBranchCount, item.missedBranchCount)}
                  </span>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
