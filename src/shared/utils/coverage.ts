export type NormalizedCoverageStatus = 'COVERED' | 'MISSED' | 'PARTIAL' | 'NEUTRAL';
export type CoverageTone = Lowercase<NormalizedCoverageStatus>;

export interface CodeCoverageDecoration {
  startLine: number;
  endLine: number;
  coverageTone: CoverageTone;
}

interface CoverageMetrics {
  coverageStatus?: string | null;
  coveredLineCount?: number | null;
  missedLineCount?: number | null;
  coveredBranchCount?: number | null;
  missedBranchCount?: number | null;
}

function normalizeUpperCaseValue(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

export function normalizeCoverageStatus(status: string | null | undefined): NormalizedCoverageStatus {
  switch (normalizeUpperCaseValue(status)) {
    case 'COVERED':
      return 'COVERED';
    case 'MISSED':
      return 'MISSED';
    case 'PARTIAL':
      return 'PARTIAL';
    default:
      return 'NEUTRAL';
  }
}

export function resolveCoverageStatus(metrics: CoverageMetrics): NormalizedCoverageStatus {
  const normalized = normalizeUpperCaseValue(metrics.coverageStatus);
  const coveredLineCount = metrics.coveredLineCount ?? 0;
  const missedLineCount = metrics.missedLineCount ?? 0;
  const coveredBranchCount = metrics.coveredBranchCount ?? 0;
  const missedBranchCount = metrics.missedBranchCount ?? 0;
  const hasCoveredExecution = coveredLineCount > 0 || coveredBranchCount > 0;
  const hasMissedExecution = missedLineCount > 0 || missedBranchCount > 0;

  if (normalized === 'PARTIAL' || (hasCoveredExecution && hasMissedExecution)) {
    return 'PARTIAL';
  }

  if (normalized === 'MISSED' || hasMissedExecution) {
    return 'MISSED';
  }

  if (normalized === 'COVERED' || hasCoveredExecution) {
    return 'COVERED';
  }

  return normalizeCoverageStatus(metrics.coverageStatus);
}

export function toCoverageTone(metrics: CoverageMetrics): CoverageTone {
  return resolveCoverageStatus(metrics).toLowerCase() as CoverageTone;
}

export function isCoverageRunSucceeded(status: string | null | undefined): boolean {
  return normalizeUpperCaseValue(status) === 'SUCCEEDED';
}

export function isCoverageRunFailed(status: string | null | undefined): boolean {
  const normalized = normalizeUpperCaseValue(status);
  return normalized === 'FAILED' || normalized === 'TIMED_OUT';
}
