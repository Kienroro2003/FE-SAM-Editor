import { useCallback, useRef, useState } from 'react';
import { streamAiSuggestedTests } from '../api/aiSuggestApi';
import type { AiSuggestTestsRequest } from '../api/types';

interface UseAiSuggestTestsStreamResult {
  suggestionText: string;
  isSuggesting: boolean;
  suggestError: string;
  startSuggesting: (payload: AiSuggestTestsRequest) => Promise<void>;
  stopSuggesting: () => void;
  resetSuggestion: () => void;
}

export function useAiSuggestTestsStream(): UseAiSuggestTestsStreamResult {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [suggestionText, setSuggestionText] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  const stopSuggesting = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSuggesting(false);
  }, []);

  const resetSuggestion = useCallback(() => {
    setSuggestionText('');
    setSuggestError('');
  }, []);

  const startSuggesting = useCallback(async (payload: AiSuggestTestsRequest) => {
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSuggestionText('');
    setSuggestError('');
    setIsSuggesting(true);

    await streamAiSuggestedTests(
      payload,
      {
        onToken: (chunk) => {
          setSuggestionText((previous) => `${previous}${chunk}`);
        },
        onError: (message) => {
          setSuggestError(message);
        },
        onDone: () => {
          setIsSuggesting(false);
        },
      },
      controller.signal,
    );

    abortControllerRef.current = null;
  }, []);

  return {
    suggestionText,
    isSuggesting,
    suggestError,
    startSuggesting,
    stopSuggesting,
    resetSuggestion,
  };
}
