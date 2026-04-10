import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import type { IRange, editor } from 'monaco-editor';
import type { WorkspaceFileContentResponse } from '../../shared/api/types';
import type { CodeCoverageDecoration, CoverageTone } from '../../shared/utils/coverage';
import { LoadingState } from '../common/LoadingState';

interface CodeFocusRequest {
  startLine: number;
  endLine: number | null;
  coverageTone: CoverageTone;
  requestKey: number;
}

interface CodeViewerProps {
  file: WorkspaceFileContentResponse | null;
  isLoading: boolean;
  focusRequest: CodeFocusRequest | null;
  coverageDecorations: CodeCoverageDecoration[];
}

const LANGUAGE_MAP: Record<string, string> = {
  JAVA: 'java',
  JAVASCRIPT: 'javascript',
  TYPESCRIPT: 'typescript',
  PYTHON: 'python',
  JSON: 'json',
  YAML: 'yaml',
  XML: 'xml',
  MARKDOWN: 'markdown',
};

function mapLanguage(language: string): string {
  return LANGUAGE_MAP[language] ?? 'plaintext';
}

type MonacoInstance = Parameters<NonNullable<ComponentProps<typeof Editor>['onMount']>>[1];

function clampLineNumber(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(lineNumber, 1), lineCount);
}

function focusDecorationClasses(coverageTone: CoverageTone): {
  className: string;
  linesDecorationsClassName: string;
} {
  return {
    className: `code-viewer-line-focus-${coverageTone}`,
    linesDecorationsClassName: `code-viewer-line-focus-gutter-${coverageTone}`,
  };
}

function coverageDecorationClassName(coverageTone: CoverageTone): string {
  return `code-viewer-line-coverage-${coverageTone}`;
}

export function CodeViewer({ file, isLoading, focusRequest, coverageDecorations }: CodeViewerProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const focusDecorationIdsRef = useRef<string[]>([]);
  const coverageDecorationIdsRef = useRef<string[]>([]);

  const clearFocusDecorations = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) {
      focusDecorationIdsRef.current = [];
      return;
    }

    focusDecorationIdsRef.current = editorInstance.deltaDecorations(focusDecorationIdsRef.current, []);
  }, []);

  const clearCoverageDecorations = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) {
      coverageDecorationIdsRef.current = [];
      return;
    }

    coverageDecorationIdsRef.current = editorInstance.deltaDecorations(coverageDecorationIdsRef.current, []);
  }, []);

  const applyFocusRequest = useCallback(
    (request: CodeFocusRequest | null) => {
      const editorInstance = editorRef.current;
      const monacoInstance = monacoRef.current;
      const model = editorInstance?.getModel();

      if (!editorInstance || !monacoInstance || !model || !request) {
        return;
      }

      const maxLine = model.getLineCount();
      const startLine = clampLineNumber(request.startLine, maxLine);
      const endLine = clampLineNumber(request.endLine ?? request.startLine, maxLine);
      const focusRange: IRange = {
        startLineNumber: Math.min(startLine, endLine),
        startColumn: 1,
        endLineNumber: Math.max(startLine, endLine),
        endColumn: model.getLineMaxColumn(Math.max(startLine, endLine)),
      };
      const decorationClasses = focusDecorationClasses(request.coverageTone);

      focusDecorationIdsRef.current = editorInstance.deltaDecorations(focusDecorationIdsRef.current, [
        {
          range: focusRange,
          options: {
            isWholeLine: true,
            className: decorationClasses.className,
            linesDecorationsClassName: decorationClasses.linesDecorationsClassName,
          },
        },
      ]);

      editorInstance.setPosition({ lineNumber: focusRange.startLineNumber, column: 1 });
      editorInstance.revealRangeInCenter(focusRange, monacoInstance.editor.ScrollType.Smooth);
    },
    [],
  );

  const applyCoverageDecorations = useCallback((nextCoverageDecorations: CodeCoverageDecoration[]) => {
    const editorInstance = editorRef.current;
    const model = editorInstance?.getModel();

    if (!editorInstance || !model) {
      return;
    }

    const maxLine = model.getLineCount();
    coverageDecorationIdsRef.current = editorInstance.deltaDecorations(
      coverageDecorationIdsRef.current,
      nextCoverageDecorations.map((decoration) => {
        const startLine = clampLineNumber(decoration.startLine, maxLine);
        const endLine = clampLineNumber(decoration.endLine, maxLine);

        return {
          range: {
            startLineNumber: Math.min(startLine, endLine),
            startColumn: 1,
            endLineNumber: Math.max(startLine, endLine),
            endColumn: model.getLineMaxColumn(Math.max(startLine, endLine)),
          },
          options: {
            isWholeLine: true,
            className: coverageDecorationClassName(decoration.coverageTone),
          },
        };
      }),
    );
  }, []);

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monacoInstance: MonacoInstance) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;

      applyCoverageDecorations(coverageDecorations);

      if (focusRequest) {
        applyFocusRequest(focusRequest);
      }
    },
    [applyCoverageDecorations, applyFocusRequest, coverageDecorations, focusRequest],
  );

  useEffect(() => {
    if (!file) {
      clearFocusDecorations();
      clearCoverageDecorations();
      return;
    }

    if (!focusRequest) {
      clearFocusDecorations();
    } else {
      applyFocusRequest(focusRequest);
    }
  }, [applyFocusRequest, clearCoverageDecorations, clearFocusDecorations, file, focusRequest]);

  useEffect(() => {
    if (!file) {
      clearCoverageDecorations();
      return;
    }

    if (coverageDecorations.length === 0) {
      clearCoverageDecorations();
      return;
    }

    applyCoverageDecorations(coverageDecorations);
  }, [applyCoverageDecorations, clearCoverageDecorations, coverageDecorations, file]);

  if (isLoading) {
    return <LoadingState message="Loading file content..." className="panel-loading" />;
  }

  if (!file) {
    return <div className="panel-muted">Select a file to preview content.</div>;
  }

  return (
    <div className="code-viewer">
      <div className="code-viewer-header">
        <span>{file.path}</span>
        <span>{file.language}</span>
      </div>
      <Editor
        height="100%"
        theme="vs-light"
        language={mapLanguage(file.language)}
        path={file.path}
        value={file.content}
        onMount={handleEditorMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
          wordWrap: 'off',
        }}
      />
    </div>
  );
}
