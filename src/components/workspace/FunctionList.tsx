import type { FunctionAnalysisSummaryResponse } from '../../shared/api/types';
import { LoadingState } from '../common/LoadingState';

interface FunctionListProps {
  functions: FunctionAnalysisSummaryResponse[];
  selectedFunctionId: number | null;
  onSelect: (functionId: number) => void;
  isLoading: boolean;
}

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

export function FunctionList({ functions, selectedFunctionId, onSelect, isLoading }: FunctionListProps) {
  if (isLoading) {
    return <LoadingState message="Analyzing functions..." className="panel-loading" />;
  }

  if (functions.length === 0) {
    return <div className="panel-muted">No analyzable methods were found in this Java file.</div>;
  }

  return (
    <div className="analysis-function-list">
      {functions.map((item) => {
        const isActive = item.functionId === selectedFunctionId;
        return (
          <button
            key={item.functionId}
            type="button"
            className={`analysis-function-item ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(item.functionId)}
          >
            <div className="analysis-function-header">
              <span className="analysis-function-name">{item.functionName}</span>
              <span className="analysis-pill">CC {item.cyclomaticComplexity}</span>
            </div>
            <div className="analysis-function-signature">{item.signature}</div>
            <div className="analysis-function-meta">{formatLineRange(item.startLine, item.endLine)}</div>
          </button>
        );
      })}
    </div>
  );
}
