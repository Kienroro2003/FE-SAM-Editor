import axios from 'axios';
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
import { resolveApiErrorMessage } from '../utils/errors';

interface AuthContextValue {
  tokens: AuthTokens | null;
  profile: MeResponse | null;
  authError: string;
  isAuthenticated: boolean;
  isProfileLoading: boolean;
  setSession: (payload: AuthResponse) => void;
  clearSession: () => void;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(() => getAuthTokens());
  const [profile, setProfile] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState('');
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

  const clearAuthError = useCallback(() => {
    setAuthError('');
  }, []);

  const clearSession = useCallback(() => {
    clearAuthTokens();
    setProfile(null);
    setAuthError('');
    setIsProfileLoading(false);
  }, []);

  const setSession = useCallback((payload: AuthResponse) => {
    setProfile(null);
    setAuthError('');
    setAuthTokens({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      tokenType: payload.tokenType || 'Bearer',
    });
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
      setAuthError('');
    } catch (error) {
      setProfile(null);

      if (axios.isAxiosError(error) && error.response?.status === 401) {
        clearAuthTokens();
        setTokens(null);
        setAuthError('Session expired. Please login again.');
      } else {
        setAuthError(resolveApiErrorMessage(error, 'Unable to load profile'));
      }
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
      authError,
      isAuthenticated: Boolean(tokens?.accessToken),
      isProfileLoading,
      setSession,
      clearSession,
      clearAuthError,
      refreshProfile,
    }),
    [tokens, profile, authError, isProfileLoading, setSession, clearSession, clearAuthError, refreshProfile],
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
