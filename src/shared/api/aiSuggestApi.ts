import { getAuthTokens } from '../storage/tokenStorage';
import type { AiSuggestTestsRequest } from './types';

const AI_SUGGEST_ENDPOINT = '/api/ai/suggest-tests';

function createAuthHeader(): string | null {
  const tokens = getAuthTokens();
  if (!tokens?.accessToken) {
    return null;
  }

  const tokenType = tokens.tokenType?.trim() || 'Bearer';
  return `${tokenType} ${tokens.accessToken}`;
}

export interface AiSuggestTestsStreamCallbacks {
  onToken: (chunk: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export async function streamAiSuggestedTests(
  payload: AiSuggestTestsRequest,
  callbacks: AiSuggestTestsStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const authHeader = createAuthHeader();

  const requestDebugId = `ai-suggest-${Date.now()}`;
  const sourceLength = payload.sourceCode?.length ?? 0;
  const testLength = payload.testCode?.length ?? 0;
  const coverage = payload.coverageResult;

  console.info('[AI Suggest] Request payload summary', {
    requestDebugId,
    endpoint: AI_SUGGEST_ENDPOINT,
    hasAuthHeader: Boolean(authHeader),
    language: payload.language,
    sourceCodeLength: sourceLength,
    testCodeLength: testLength,
    coveragePercentage: coverage.coveragePercentage,
    coveredLinesCount: coverage.coveredLines.length,
    uncoveredLinesCount: coverage.uncoveredLines.length,
    coveredBranchesCount: coverage.coveredBranches.length,
    uncoveredBranchesCount: coverage.uncoveredBranches.length,
    coveredFunctionsCount: coverage.coveredFunctions.length,
    uncoveredFunctionsCount: coverage.uncoveredFunctions.length,
    isTestCodeEmptyAfterTrim: payload.testCode.trim().length === 0,
  });

  const response = await fetch(AI_SUGGEST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const fallback = `AI suggest failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`;

    try {
      const rawError = (await response.text()).trim();
      if (!rawError) {
        callbacks.onError(fallback);
        callbacks.onDone();
        return;
      }

      try {
        const parsed = JSON.parse(rawError) as { message?: string; error?: string; details?: string };
        const detailedMessage = parsed.message || parsed.error || parsed.details || rawError;
        callbacks.onError(`${fallback}: ${detailedMessage}`);
      } catch {
        callbacks.onError(`${fallback}: ${rawError}`);
      }
    } catch {
      callbacks.onError(fallback);
    }

    callbacks.onDone();
    return;
  }

  if (!response.body) {
    callbacks.onError('AI suggest stream is unavailable.');
    callbacks.onDone();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';

  const flushEvent = () => {
    if (!eventName) {
      return;
    }

    const eventData = buffer.trimEnd();
    if (eventName === 'token' && eventData) {
      callbacks.onToken(eventData);
    }

    eventName = '';
    buffer = '';
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        flushEvent();
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split(/\r?\n/);

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const dataPart = line.slice(5).trimStart();
          buffer = buffer.length > 0 ? `${buffer}\n${dataPart}` : dataPart;
          continue;
        }

        if (line.trim() === '') {
          flushEvent();
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      callbacks.onError('AI suggest stream interrupted. Please try again.');
    }
  } finally {
    callbacks.onDone();
  }
}
