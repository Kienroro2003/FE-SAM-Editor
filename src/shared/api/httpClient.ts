import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { clearAuthTokens, getAuthTokens, setAuthTokens } from '../storage/tokenStorage';
import type { AuthResponse, RefreshTokenRequest } from './types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

const rawHttpClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: false,
});

export const httpClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: false,
});

let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  const currentTokens = getAuthTokens();
  if (!currentTokens?.refreshToken) {
    clearAuthTokens();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = rawHttpClient
      .post<AuthResponse, { data: AuthResponse }, RefreshTokenRequest>('/auth/refresh-token', {
        refreshToken: currentTokens.refreshToken,
      })
      .then((response) => {
        const payload = response.data;
        setAuthTokens({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          tokenType: payload.tokenType || 'Bearer',
        });
        return payload.accessToken;
      })
      .catch(() => {
        clearAuthTokens();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

httpClient.interceptors.request.use((config) => {
  const tokens = getAuthTokens();
  if (tokens?.accessToken) {
    const tokenType = tokens.tokenType || 'Bearer';
    config.headers.Authorization = `${tokenType} ${tokens.accessToken}`;
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (status !== 401 || !originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    const nextAccessToken = await refreshAccessToken();
    if (!nextAccessToken) {
      return Promise.reject(error);
    }

    const tokens = getAuthTokens();
    const tokenType = tokens?.tokenType || 'Bearer';
    originalRequest.headers = {
      ...originalRequest.headers,
      Authorization: `${tokenType} ${nextAccessToken}`,
    };
    return httpClient.request(originalRequest);
  },
);
