import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef, type ComponentProps } from 'react';
import type { IRange, editor } from 'monaco-editor';
import type { WorkspaceFileContentResponse } from '../../shared/api/types';
import { LoadingState } from '../common/LoadingState';

interface CodeFocusRequest {
  startLine: number;
  endLine: number | null;
  requestKey: number;
}

interface CodeViewerProps {
  file: WorkspaceFileContentResponse | null;
  isLoading: boolean;
  focusRequest: CodeFocusRequest | null;
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

export function CodeViewer({ file, isLoading, focusRequest }: CodeViewerProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorationIdsRef = useRef<string[]>([]);

  const clearFocusDecorations = useCallback(() => {
    const editorInstance = editorRef.current;
    if (!editorInstance) {
      decorationIdsRef.current = [];
      return;
    }

    decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, []);
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

      decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, [
        {
          range: focusRange,
          options: {
            isWholeLine: true,
            className: 'code-viewer-line-focus',
            linesDecorationsClassName: 'code-viewer-line-focus-gutter',
          },
        },
      ]);

      editorInstance.setPosition({ lineNumber: focusRange.startLineNumber, column: 1 });
      editorInstance.revealRangeInCenter(focusRange, monacoInstance.editor.ScrollType.Smooth);
    },
    [],
  );

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monacoInstance: MonacoInstance) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;

      if (focusRequest) {
        applyFocusRequest(focusRequest);
      }
    },
    [applyFocusRequest, focusRequest],
  );

  useEffect(() => {
    if (!file) {
      clearFocusDecorations();
      return;
    }

    if (!focusRequest) {
      clearFocusDecorations();
      return;
    }

    applyFocusRequest(focusRequest);
  }, [applyFocusRequest, clearFocusDecorations, file, focusRequest]);

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
