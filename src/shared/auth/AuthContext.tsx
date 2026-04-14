import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../api/authApi';
import type { AuthResponse, AuthTokens, MeResponse } from '../api/types';
import {
  AUTH_EVENT_NAME,
  clearAuthTokens,
  getAuthTokens,
  setAuthTokens,
} from '../storage/tokenStorage';

interface AuthContextValue {
  tokens: AuthTokens | null;
  profile: MeResponse | null;
  isAuthenticated: boolean;
  isProfileLoading: boolean;
  setSession: (payload: AuthResponse) => void;
  clearSession: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(() => getAuthTokens());
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  useEffect(() => {
    const onTokensChanged = () => {
      setTokens(getAuthTokens());
    };
    window.addEventListener(AUTH_EVENT_NAME, onTokensChanged);
    return () => {
      window.removeEventListener(AUTH_EVENT_NAME, onTokensChanged);
    };
  }, []);

  const clearSession = useCallback(() => {
    clearAuthTokens();
    setTokens(null);
    setProfile(null);
    setIsProfileLoading(false);
  }, []);

  const setSession = useCallback((payload: AuthResponse) => {
    const nextTokens: AuthTokens = {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      tokenType: payload.tokenType || 'Bearer',
    };

    setProfile(null);
    setAuthTokens(nextTokens);
    setTokens(nextTokens);
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentTokens = getAuthTokens();
    if (!currentTokens?.accessToken) {
      setProfile(null);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);
    try {
      const response = await authApi.me();
      setProfile(response.data);
    } catch {
      setProfile(null);
    } finally {
      setIsProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokens?.accessToken) {
      void refreshProfile();
      return;
    }
    setProfile(null);
  }, [tokens?.accessToken, refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      tokens,
      profile,
      isAuthenticated: Boolean(tokens?.accessToken),
      isProfileLoading,
      setSession,
      clearSession,
      refreshProfile,
    }),
    [tokens, profile, isProfileLoading, setSession, clearSession, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
