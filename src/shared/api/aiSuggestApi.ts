import { AxiosError } from 'axios';
import { getAuthTokens } from '../storage/tokenStorage';
import { httpClient } from './httpClient';
import type { AiSuggestTestsRequest } from './types';

const AI_SUGGEST_ENDPOINT = '/ai/suggest-tests';

export interface AiSuggestTestsStreamCallbacks {
  onToken: (chunk: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

function parseSsePayload(raw: string, callbacks: AiSuggestTestsStreamCallbacks): void {
  const lines = raw.split(/\r?\n/);
  let eventName = '';
  let dataBuffer = '';
  let hasTokenEvent = false;

  const flushEvent = () => {
    if (!eventName) {
      return;
    }

    const eventData = dataBuffer.trimEnd();
    if (eventName === 'token' && eventData) {
      callbacks.onToken(eventData);
      hasTokenEvent = true;
    }

    eventName = '';
    dataBuffer = '';
  };

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      const dataPart = line.slice(5).trimStart();
      dataBuffer = dataBuffer.length > 0 ? `${dataBuffer}\n${dataPart}` : dataPart;
      continue;
    }

    if (line.trim() === '') {
      flushEvent();
    }
  }

  flushEvent();

  if (!hasTokenEvent) {
    const fallback = raw.trim();
    if (fallback) {
      callbacks.onToken(fallback);
    }
  }
}

function resolveAxiosErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.code === 'ERR_CANCELED') {
      return '';
    }

    const status = error.response?.status;
    const statusText = error.response?.statusText;
    if (status === 401) {
      return 'Session expired or unauthorized. Please log in again.';
    }

    const fallback = `AI suggest failed (${status ?? 'unknown'}${statusText ? ` ${statusText}` : ''})`;
    const responseData = error.response?.data;

    if (typeof responseData === 'string' && responseData.trim().length > 0) {
      try {
        const parsed = JSON.parse(responseData) as { message?: string; error?: string; details?: string };
        const detailedMessage = parsed.message || parsed.error || parsed.details || responseData;
        return `${fallback}: ${detailedMessage}`;
      } catch {
        return `${fallback}: ${responseData}`;
      }
    }

    return fallback;
  }

  return 'Unable to reach AI suggest service. Please try again.';
}

export async function streamAiSuggestedTests(
  payload: AiSuggestTestsRequest,
  callbacks: AiSuggestTestsStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const tokens = getAuthTokens();
  const hasAuthHeader = Boolean(tokens?.accessToken);

  const requestDebugId = `ai-suggest-${Date.now()}`;
  const sourceLength = payload.sourceCode?.length ?? 0;
  const testLength = payload.testCode?.length ?? 0;
  const coverage = payload.coverageResult;

  console.info('[AI Suggest] Request payload summary', {
    requestDebugId,
    endpoint: AI_SUGGEST_ENDPOINT,
    hasAuthHeader,
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

  try {
    const response = await httpClient.post<string>(AI_SUGGEST_ENDPOINT, payload, {
      headers: {
        Accept: 'text/event-stream',
      },
      withCredentials: true,
      responseType: 'text',
      signal,
    });

    const rawBody = typeof response.data === 'string' ? response.data : '';
    if (!rawBody.trim()) {
      callbacks.onError('AI suggest stream is unavailable.');
      return;
    }

    parseSsePayload(rawBody, callbacks);
  } catch (error) {
    const message = resolveAxiosErrorMessage(error);
    if (message) {
      callbacks.onError(message);
    }
  } finally {
    callbacks.onDone();
  }
}
