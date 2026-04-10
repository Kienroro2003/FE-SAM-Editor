import { httpClient } from './httpClient';
import type {
  ApiMessage,
  AuthResponse,
  GithubLoginHintResponse,
  LoginRequest,
  MeResponse,
  RefreshTokenRequest,
  RegisterRequest,
  VerifyOtpRequest,
} from './types';

export const authApi = {
  register(payload: RegisterRequest) {
    return httpClient.post<ApiMessage>('/auth/register', payload);
  },
  verifyOtp(payload: VerifyOtpRequest) {
    return httpClient.post<AuthResponse>('/auth/verify-otp', payload);
  },
  resendOtp(email: string) {
    return httpClient.post<ApiMessage>('/auth/resend-otp', null, {
      params: { email },
    });
  },
  login(payload: LoginRequest) {
    return httpClient.post<AuthResponse>('/auth/login', payload);
  },
  refreshToken(payload: RefreshTokenRequest) {
    return httpClient.post<AuthResponse>('/auth/refresh-token', payload);
  },
  me() {
    return httpClient.get<MeResponse>('/auth/me');
  },
  logout(payload: RefreshTokenRequest) {
    return httpClient.post<ApiMessage>('/auth/logout', payload);
  },
  logoutAll() {
    return httpClient.post<ApiMessage>('/auth/logout-all');
  },
  githubLoginHint() {
    return httpClient.get<GithubLoginHintResponse>('/auth/github');
  },
};
