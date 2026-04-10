# BE-SAM-Editor Frontend

React + Vite + TypeScript frontend for existing BE auth/workspace APIs.

## Features in this version

- Auth flows: register, verify OTP, resend OTP, login, GitHub OAuth redirect, refresh token, logout, logout-all.
- Workspace flows: import GitHub repo, import ZIP folder, list workspaces, render file tree, open file content in read-only Monaco editor.
- Token handling with automatic access-token refresh on `401`.
- OpenAPI sync pipeline from BE endpoint `/v3/api-docs`.

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Vite runs on `http://localhost:3000` and proxies BE requests to `http://localhost:8080`.

## Environment

Copy `.env.example` to `.env.local` if you need custom values.

- `VITE_API_BASE_URL` default: `/api`
- `VITE_API_ORIGIN` default: `http://localhost:8080`

## OpenAPI contract sync

```bash
npm run openapi:sync
npm run openapi:types
# or
npm run openapi:refresh
```

This updates:

- `openapi/openapi.json`
- `src/shared/api/generated/openapi-types.ts`
# FE-SAM-Editor
