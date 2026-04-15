import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { workspaceApi } from '../../shared/api/workspaceApi';
import type { CoverageFunctionSummaryResponse, WorkspaceFileContentResponse } from '../../shared/api/types';
import { useAiSuggestTestsStream } from '../../shared/hooks/useAiSuggestTestsStream';
import { resolveCoverageStatus } from '../../shared/utils/coverage';

interface AiSuggestTestsPanelProps {
  projectId: number | null;
  sourceFilePath: string | null;
  sourceFile: WorkspaceFileContentResponse | null;
  coverageFunctions: CoverageFunctionSummaryResponse[];
  disabled: boolean;
  autoSuggestRunId: number | null;
}

type SuggestionBlock =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'code';
      content: string;
      language: string;
    };

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

function mapSuggestionCodeLanguage(languageHint: string | undefined, fallbackLanguage: string | null | undefined): string {
  const normalizedHint = (languageHint ?? '').trim().toLowerCase();
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    yml: 'yaml',
    md: 'markdown',
  };

  if (normalizedHint.length > 0) {
    return languageMap[normalizedHint] ?? normalizedHint;
  }

  return mapLanguage(fallbackLanguage);
}

function formatSuggestionExplanation(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/(^|\n)(\d+)\.\*\*/g, '$1$2. **')
    .replace(/\*\*Testfor`([^`]+)`/g, '**Test for `$1`')
    .replace(/Thistesttargetsuncoveredlines/gi, 'This test targets uncovered lines ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/(\d)and(\d)/gi, '$1 and $2')
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function splitSuggestionBlocks(rawText: string, fallbackLanguage: string | null | undefined): SuggestionBlock[] {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/```([a-zA-Z0-9_+-]+)(?=\S)/g, '```$1\n');

  const fencePattern = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  const blocks: SuggestionBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while (true) {
    match = fencePattern.exec(normalized);
    if (!match) {
      break;
    }

    const beforeFence = normalized.slice(lastIndex, match.index);
    const formattedText = formatSuggestionExplanation(beforeFence);
    if (formattedText.length > 0) {
      blocks.push({
        type: 'text',
        content: formattedText,
      });
    }

    const languageHint = match[1]?.trim();
    const codeContent = match[2].replace(/^\n+|\n+$/g, '');
    if (codeContent.trim().length > 0) {
      blocks.push({
        type: 'code',
        language: mapSuggestionCodeLanguage(languageHint, fallbackLanguage),
        content: codeContent,
      });
    }

    lastIndex = fencePattern.lastIndex;
  }

  const tail = normalized.slice(lastIndex);
  const formattedTail = formatSuggestionExplanation(tail);
  if (formattedTail.length > 0) {
    blocks.push({
      type: 'text',
      content: formattedTail,
    });
  }

  return blocks;
}

function codeBlockHeight(content: string): string {
  const lineCount = content.split('\n').length;
  const visibleLines = Math.min(Math.max(lineCount, 6), 24);
  return `${visibleLines * 20 + 24}px`;
}

function toWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function resolveTestPathCandidates(sourcePath: string): string[] {
  const normalizedPath = toWorkspacePath(sourcePath).replace(/^\/+/, '');
  const extensionIndex = normalizedPath.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return [];
  }

  const extension = normalizedPath.slice(extensionIndex);
  const pathWithoutExt = normalizedPath.slice(0, extensionIndex);
  const lastSlashIndex = pathWithoutExt.lastIndexOf('/');
  const directory = lastSlashIndex >= 0 ? pathWithoutExt.slice(0, lastSlashIndex) : '';
  const fileName = lastSlashIndex >= 0 ? pathWithoutExt.slice(lastSlashIndex + 1) : pathWithoutExt;

  const candidates = new Set<string>();

  if (extension === '.java') {
    if (normalizedPath.includes('/src/main/java/')) {
      const swapped = normalizedPath.replace('/src/main/java/', '/src/test/java/');
      const swappedNoExt = swapped.slice(0, swapped.length - '.java'.length);
      candidates.add(`${swappedNoExt}Test.java`);
      candidates.add(`${swappedNoExt}Tests.java`);
    }

    if (directory) {
      candidates.add(`${directory}/${fileName}Test.java`);
      candidates.add(`${directory}/${fileName}Tests.java`);
    }
  } else {
    if (directory) {
      candidates.add(`${directory}/${fileName}.test${extension}`);
      candidates.add(`${directory}/${fileName}.spec${extension}`);
      candidates.add(`${directory}/__tests__/${fileName}.test${extension}`);
      candidates.add(`${directory}/__tests__/${fileName}.spec${extension}`);
    }

    if (normalizedPath.startsWith('src/')) {
      const relative = normalizedPath.slice('src/'.length);
      const relativeNoExt = relative.slice(0, relative.length - extension.length);
      candidates.add(`tests/${relativeNoExt}.test${extension}`);
      candidates.add(`tests/${relativeNoExt}.spec${extension}`);
    }
  }

  return [...candidates];
}

async function loadExistingTestCode(projectId: number, sourcePath: string): Promise<string | null> {
  const candidates = resolveTestPathCandidates(sourcePath);

  for (const testPath of candidates) {
    try {
      const response = await workspaceApi.getWorkspaceFileContent(projectId, testPath);
      const content = response.data.content?.trim();
      if (content) {
        return response.data.content;
      }
    } catch {
      // Ignore missing candidate path and continue trying next one.
    }
  }

  return null;
}

export function AiSuggestTestsPanel({
  projectId,
  sourceFilePath,
  sourceFile,
  coverageFunctions,
  disabled,
  autoSuggestRunId,
}: AiSuggestTestsPanelProps) {
  const { suggestionText, suggestError, isSuggesting, startSuggesting, stopSuggesting } = useAiSuggestTestsStream();
  const lastAutoRunIdRef = useRef<number | null>(null);
  const suggestionBlocks = useMemo(
    () => splitSuggestionBlocks(suggestionText, sourceFile?.language),
    [suggestionText, sourceFile?.language],
  );

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

  const canSuggest =
    !disabled && Boolean(projectId) && Boolean(sourceFilePath) && Boolean(sourceFile?.content) && coverageFunctions.length > 0;

  const handleSuggest = useCallback(async () => {
    if (!canSuggest || !sourceFile || !sourceFilePath || !projectId) {
      return;
    }

    const existingTestCode = await loadExistingTestCode(projectId, sourceFilePath);
    const fallbackTestCode = [
      `// Auto-generated context for ${sourceFilePath}`,
      '// No existing test file content was found in workspace.',
      '// Please suggest new tests to cover uncovered logic below.',
    ].join('\n');

    await startSuggesting({
      sourceCode: sourceFile.content,
      testCode: existingTestCode ?? fallbackTestCode,
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
  }, [
    canSuggest,
    coveredFunctions,
    coveredLines,
    coveragePercentage,
    projectId,
    sourceFile,
    sourceFilePath,
    startSuggesting,
    uncoveredFunctions,
    uncoveredLines,
  ]);

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
            <div className="analysis-run-suggestion-content">
              {suggestionBlocks.length > 0 ? (
                suggestionBlocks.map((block, index) => {
                  if (block.type === 'code') {
                    return (
                      <div className="analysis-run-suggest-code" key={`code-${index}`}>
                        <Editor
                          height={codeBlockHeight(block.content)}
                          theme="vs"
                          language={block.language}
                          value={block.content}
                          options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            fontSize: 13,
                            lineHeight: 20,
                            fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                            wordWrap: 'on',
                            renderLineHighlight: 'none',
                            glyphMargin: false,
                            folding: false,
                            overviewRulerLanes: 0,
                            padding: {
                              top: 8,
                              bottom: 8,
                            },
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <pre className="analysis-run-suggest-text" key={`text-${index}`}>
                      {block.content}
                    </pre>
                  );
                })
              ) : (
                <pre className="analysis-run-suggest-text">{formatSuggestionExplanation(suggestionText)}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
