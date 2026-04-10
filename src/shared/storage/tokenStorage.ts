import type { AuthTokens } from '../api/types';

const TOKEN_STORAGE_KEY = 'sam_editor_auth_tokens';
export const AUTH_EVENT_NAME = 'sam-editor-auth-updated';

function resolveTokenType(tokenType?: string): string {
  if (!tokenType || tokenType.trim().length === 0) {
    return 'Bearer';
  }
  return tokenType;
}

function emitAuthUpdatedEvent() {
  window.dispatchEvent(new Event(AUTH_EVENT_NAME));
}

export function getAuthTokens(): AuthTokens | null {
  const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    if (!parsed.accessToken || typeof parsed.accessToken !== 'string') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      tokenType: resolveTokenType(parsed.tokenType),
    };
  } catch {
    return null;
  }
}

export function setAuthTokens(tokens: AuthTokens) {
  const normalized: AuthTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    tokenType: resolveTokenType(tokens.tokenType),
  };
  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(normalized));
  emitAuthUpdatedEvent();
}

export function clearAuthTokens() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  emitAuthUpdatedEvent();
}
