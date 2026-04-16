import { useEffect, useMemo, useState } from 'react';
import { analysisApi } from '../../shared/api/analysisApi';
import { workspaceApi } from '../../shared/api/workspaceApi';
import type {
  FunctionAnalysisSummaryResponse,
  JavaFileAnalysisResponse,
  WorkspaceSummaryResponse,
} from '../../shared/api/types';
import { formatBytes } from '../../shared/utils/format';

interface DashboardStats {
  totalWorkspaces: number;
  totalFiles: number;
  githubWorkspaces: number;
  localWorkspaces: number;
  totalFunctionsAnalyzed: number;
  avgCyclomaticComplexity: number;
  highComplexityFiles: number;
  recentlyAnalyzed: AnalyzedFileSummary[];
  complexityDistribution: ComplexityBucket[];
  workspaceStats: WorkspaceStatItem[];
}

interface AnalyzedFileSummary {
  projectId: number;
  path: string;
  functionCount: number;
  avgComplexity: number;
  maxComplexity: number;
}

interface ComplexityBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

interface WorkspaceStatItem {
  projectId: number;
  name: string;
  sourceType: 'GITHUB' | 'LOCAL_FOLDER' | string;
  fileCount: number;
  functionCount: number;
}

function buildComplexityBuckets(): ComplexityBucket[] {
  return [
    { label: '1–5', min: 1, max: 5, count: 0 },
    { label: '6–10', min: 6, max: 10, count: 0 },
    { label: '11–15', min: 11, max: 15, count: 0 },
    { label: '16–20', min: 16, max: 20, count: 0 },
    { label: '21+', min: 21, max: Infinity, count: 0 },
  ];
}

function classifyComplexity(cc: number): ComplexityBucket | undefined {
  const buckets = buildComplexityBuckets();
  return buckets.find((b) => cc >= b.min && cc <= b.max);
}

function resolveComplexityTier(cc: number): 'low' | 'medium' | 'high' | 'very-high' {
  if (cc <= 5) return 'low';
  if (cc <= 10) return 'medium';
  if (cc <= 20) return 'high';
  return 'very-high';
}

function resolveComplexityColor(tier: string): string {
  switch (tier) {
    case 'low':
      return '#0f9d58';
    case 'medium':
      return '#b7791f';
    case 'high':
      return '#c05621';
    default:
      return '#cc3b3b';
  }
}

function resolveComplexityLabel(tier: string): string {
  switch (tier) {
    case 'low':
      return 'Simple';
    case 'medium':
      return 'Moderate';
    case 'high':
      return 'Complex';
    default:
      return 'Very Complex';
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

interface DashboardCardProps {
  icon: string;
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
}

function DashboardCard({ icon, label, value, sublabel, accent }: DashboardCardProps) {
  return (
    <div className={`dashboard-card ${accent ? 'accent' : ''}`}>
      <span className="dashboard-card-icon">{icon}</span>
      <div className="dashboard-card-body">
        <span className="dashboard-card-label">{label}</span>
        <span className="dashboard-card-value">{value}</span>
        {sublabel && <span className="dashboard-card-sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}

export function DashboardPanel() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryResponse[]>([]);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [analyzedSummaries, setAnalyzedSummaries] = useState<Map<string, JavaFileAnalysisResponse>>(new Map());
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const stats = useMemo<DashboardStats>(() => {
    const githubCount = workspaces.filter((w) => w.sourceType === 'GITHUB').length;
    const localCount = workspaces.filter((w) => w.sourceType === 'LOCAL_FOLDER').length;

    const allFunctions: FunctionAnalysisSummaryResponse[] = [];
    const fileSummaries: AnalyzedFileSummary[] = [];
    const buckets = buildComplexityBuckets();
    let highComplexityFiles = 0;

    analyzedSummaries.forEach((summary) => {
      const functions = summary.functions ?? [];
      allFunctions.push(...functions);

      const avgComplexity = functions.length > 0
        ? functions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / functions.length
        : 0;
      const maxComplexity = functions.length > 0
        ? Math.max(...functions.map((f) => f.cyclomaticComplexity))
        : 0;

      if (maxComplexity > 10) {
        highComplexityFiles += 1;
      }

      fileSummaries.push({
        projectId: summary.projectId,
        path: summary.path,
        functionCount: functions.length,
        avgComplexity: Math.round(avgComplexity * 10) / 10,
        maxComplexity,
      });

      functions.forEach((fn) => {
        const bucket = classifyComplexity(fn.cyclomaticComplexity);
        if (bucket) {
          bucket.count += 1;
        }
      });
    });

    const totalFiles = analyzedSummaries.size;
    const totalFunctions = allFunctions.length;
    const avgCC = totalFunctions > 0
      ? Math.round(allFunctions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / totalFunctions * 10) / 10
      : 0;

    const sortedByFunctions = [...fileSummaries].sort((a, b) => b.functionCount - a.functionCount);
    const topFiles = sortedByFunctions.slice(0, 5);
    const sortedByComplexity = [...fileSummaries].sort((a, b) => b.avgComplexity - a.avgComplexity);
    const complexFiles = sortedByComplexity.slice(0, 5);

    const workspaceStatMap = new Map<number, WorkspaceStatItem>();
    fileSummaries.forEach((fs) => {
      const existing = workspaceStatMap.get(fs.projectId);
      if (existing) {
        existing.functionCount += fs.functionCount;
      } else {
        const ws = workspaces.find((w) => w.projectId === fs.projectId);
        workspaceStatMap.set(fs.projectId, {
          projectId: fs.projectId,
          name: ws?.name ?? `Project #${fs.projectId}`,
          sourceType: ws?.sourceType ?? 'UNKNOWN',
          fileCount: 0,
          functionCount: fs.functionCount,
        });
      }
    });

    return {
      totalWorkspaces: workspaces.length,
      totalFiles,
      githubWorkspaces: githubCount,
      localWorkspaces: localCount,
      totalFunctionsAnalyzed: totalFunctions,
      avgCyclomaticComplexity: avgCC,
      highComplexityFiles,
      recentlyAnalyzed: [...fileSummaries].sort((a, b) => b.maxComplexity - a.maxComplexity).slice(0, 8),
      complexityDistribution: buckets,
      workspaceStats: Array.from(workspaceStatMap.values()),
    };
  }, [analyzedSummaries, workspaces]);

  const maxBucketCount = useMemo(
    () => Math.max(...stats.complexityDistribution.map((b) => b.count), 1),
    [stats.complexityDistribution],
  );

  useEffect(() => {
    setIsLoadingWorkspaces(true);
    workspaceApi
      .getMyWorkspaces()
      .then((res) => setWorkspaces(res.data))
      .catch(() => setWorkspaceError('Unable to load workspaces.'))
      .finally(() => setIsLoadingWorkspaces(false));
  }, []);

  const handleAnalyzeAllWorkspaces = async () => {
    if (workspaces.length === 0) return;
    setIsAnalyzing(true);
    setAnalyzedSummaries(new Map());

    for (const ws of workspaces) {
      try {
        const tree = await workspaceApi.getWorkspaceTree(ws.projectId);
        const javaFiles = collectJavaFiles(tree.data.nodes ?? []);
        for (const file of javaFiles.slice(0, 8)) {
          try {
            const result = await analysisApi.analyzeJavaFile(ws.projectId, file.path);
            setAnalyzedSummaries((prev) => {
              const next = new Map(prev);
              next.set(`${ws.projectId}:${file.path}`, result.data);
              return next;
            });
          } catch {
            // skip files that fail analysis
          }
        }
      } catch {
        // skip workspaces that fail
      }
    }

    setIsAnalyzing(false);
  };

  if (isLoadingWorkspaces) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="dashboard-loading">
        <span className="feedback error">{workspaceError}</span>
      </div>
    );
  }

  return (
    <div className="dashboard-panel">
      {/* Overview Cards */}
      <section className="dashboard-section">
        <h3 className="dashboard-section-title">Overview</h3>
        <div className="dashboard-cards-grid">
          <DashboardCard
            icon="📁"
            label="Workspaces"
            value={stats.totalWorkspaces}
            sublabel={`${stats.githubWorkspaces} GitHub · ${stats.localWorkspaces} Local`}
          />
          <DashboardCard
            icon="📄"
            label="Files Analyzed"
            value={stats.totalFiles}
            sublabel="Java files processed"
          />
          <DashboardCard
            icon="🔧"
            label="Functions"
            value={stats.totalFunctionsAnalyzed}
            sublabel="Total functions found"
            accent
          />
          <DashboardCard
            icon="📊"
            label="Avg Complexity"
            value={stats.avgCyclomaticComplexity}
            sublabel="Cyclomatic complexity"
          />
        </div>
      </section>

      {/* Complexity Breakdown */}
      <section className="dashboard-section">
        <div className="dashboard-section-header">
          <h3 className="dashboard-section-title">Complexity Breakdown</h3>
          <button
            type="button"
            className="dashboard-action-button"
            onClick={handleAnalyzeAllWorkspaces}
            disabled={isAnalyzing || workspaces.length === 0}
          >
            {isAnalyzing ? (
              <>
                <span className="loading-spinner" />
                Analyzing...
              </>
            ) : (
              '↻ Analyze All'
            )}
          </button>
        </div>

        {stats.totalFunctionsAnalyzed === 0 ? (
          <div className="dashboard-empty-state">
            <span>No analysis data yet.</span>
            <button
              type="button"
              className="dashboard-action-button primary"
              onClick={handleAnalyzeAllWorkspaces}
              disabled={isAnalyzing || workspaces.length === 0}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze all workspaces'}
            </button>
          </div>
        ) : (
          <>
            {/* Bar Chart */}
            <div className="dashboard-bar-chart">
              {stats.complexityDistribution.map((bucket) => {
                const percentage = Math.round((bucket.count / maxBucketCount) * 100);
                return (
                  <div key={bucket.label} className="dashboard-bar-row">
                    <span className="dashboard-bar-label">{bucket.label}</span>
                    <div className="dashboard-bar-track">
                      <div
                        className="dashboard-bar-fill"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="dashboard-bar-count">{bucket.count}</span>
                  </div>
                );
              })}
            </div>

            {/* Complexity Legend */}
            <div className="dashboard-complexity-legend">
              <span className="dashboard-complexity-legend-item">
                <span className="dashboard-complexity-swatch" style={{ background: '#0f9d58' }} />
                Simple (1–5)
              </span>
              <span className="dashboard-complexity-legend-item">
                <span className="dashboard-complexity-swatch" style={{ background: '#b7791f' }} />
                Moderate (6–10)
              </span>
              <span className="dashboard-complexity-legend-item">
                <span className="dashboard-complexity-swatch" style={{ background: '#c05621' }} />
                Complex (11–20)
              </span>
              <span className="dashboard-complexity-legend-item">
                <span className="dashboard-complexity-swatch" style={{ background: '#cc3b3b' }} />
                Very Complex (21+)
              </span>
            </div>

            {/* High Complexity Alert */}
            {stats.highComplexityFiles > 0 && (
              <div className="dashboard-alert">
                <span className="dashboard-alert-icon">⚠</span>
                <span>
                  <strong>{stats.highComplexityFiles} files</strong> have high cyclomatic complexity (CC &gt; 10) and may need refactoring.
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Most Complex Files */}
      {stats.recentlyAnalyzed.length > 0 && (
        <section className="dashboard-section">
          <h3 className="dashboard-section-title">Most Complex Files</h3>
          <div className="dashboard-list">
            {stats.recentlyAnalyzed.slice(0, 6).map((item) => {
              const tier = resolveComplexityTier(item.maxComplexity);
              const color = resolveComplexityColor(tier);
              const tierLabel = resolveComplexityLabel(tier);
              return (
                <div key={`${item.projectId}:${item.path}`} className="dashboard-list-item">
                  <div className="dashboard-list-main">
                    <span className="dashboard-list-name" title={item.path}>
                      {fileNameFromPath(item.path)}
                    </span>
                    <span className="dashboard-list-meta">{item.path}</span>
                  </div>
                  <div className="dashboard-list-stats">
                    <span className="dashboard-complexity-badge" style={{ color, borderColor: color, background: `${color}18` }}>
                      CC {item.maxComplexity}
                    </span>
                    <span className="dashboard-tier-badge" style={{ color, borderColor: color, background: `${color}18` }}>
                      {tierLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Workspace Summary */}
      {stats.workspaceStats.length > 0 && (
        <section className="dashboard-section">
          <h3 className="dashboard-section-title">Workspace Summary</h3>
          <div className="dashboard-list">
            {stats.workspaceStats.map((ws) => (
              <div key={ws.projectId} className="dashboard-list-item">
                <div className="dashboard-list-main">
                  <span className="dashboard-list-name">{ws.name}</span>
                  <span className="dashboard-list-meta">
                    <span className={`dashboard-source-badge ${ws.sourceType.toLowerCase()}`}>
                      {ws.sourceType === 'GITHUB' ? 'GitHub' : 'Local'}
                    </span>
                  </span>
                </div>
                <div className="dashboard-list-stats">
                  <span className="dashboard-stat-chip">{ws.functionCount} functions</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'folder' | string;
  children?: TreeNode[];
}

function collectJavaFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'folder') {
      return collectJavaFiles(node.children ?? []);
    }
    if (node.name.toLowerCase().endsWith('.java')) {
      return [node];
    }
    return [];
  });
}
