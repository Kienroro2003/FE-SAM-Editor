import type { RefObject } from 'react';
import { LoadingState } from '../common/LoadingState';

type AuthAction = 'refresh' | 'logout' | 'logoutAll' | null;

interface WorkspaceTopbarProps {
  profileEmail?: string;
  workspaceCount: number;
  activeWorkspaceName: string | null;
  isCollapsed: boolean;
  isProfileLoading: boolean;
  activeAuthAction: AuthAction;
  isSettingsMenuOpen: boolean;
  settingsMenuRef: RefObject<HTMLDivElement>;
  onToggleCollapsed: () => void;
  onToggleSettingsMenu: () => void;
  onRefreshToken: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
}

export function WorkspaceTopbar({
  profileEmail,
  workspaceCount,
  activeWorkspaceName,
  isCollapsed,
  isProfileLoading,
  activeAuthAction,
  isSettingsMenuOpen,
  settingsMenuRef,
  onToggleCollapsed,
  onToggleSettingsMenu,
  onRefreshToken,
  onLogout,
  onLogoutAll,
}: WorkspaceTopbarProps) {
  const isAuthActionLoading = activeAuthAction !== null;
  const isSettingsBusy = activeAuthAction === 'refresh' || activeAuthAction === 'logoutAll';
  const workspaceLabel =
    activeWorkspaceName ?? `${workspaceCount} workspace${workspaceCount === 1 ? '' : 's'}`;

  return (
    <header className={`workspace-topbar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="topbar-title-block">
        {isCollapsed ? (
          <div className="topbar-collapsed-meta">
            <span className="topbar-mini-title">Workspace Explorer</span>
            <span className={`stat-pill ${activeWorkspaceName ? 'accent' : ''}`}>{workspaceLabel}</span>
          </div>
        ) : (
          <>
            <h1>Workspace Explorer</h1>
            <p className="workspace-subtitle">Import nhanh, duyệt cây file, đọc mã nguồn trong một màn hình.</p>
            <div className="workspace-stats">
              <span className="stat-pill">{workspaceCount} workspace</span>
              {activeWorkspaceName && <span className="stat-pill accent">Current: {activeWorkspaceName}</span>}
            </div>
          </>
        )}
      </div>

      <div className="topbar-actions">
        {isProfileLoading ? (
          <LoadingState message="Loading profile..." compact className="topbar-inline-loading" />
        ) : (
          <span className="user-email">{profileEmail || 'Authenticated user'}</span>
        )}
        <button
          type="button"
          className="button-secondary topbar-collapse-button"
          onClick={onToggleCollapsed}
          aria-label={isCollapsed ? 'Show workspace header' : 'Hide workspace header'}
          title={isCollapsed ? 'Show workspace header' : 'Hide workspace header'}
        >
          <span className="topbar-collapse-icon" aria-hidden="true">
            {isCollapsed ? '▾' : '▴'}
          </span>
          <span>{isCollapsed ? 'Show Header' : 'Focus Mode'}</span>
        </button>
        <button type="button" className="button-secondary" onClick={onLogout} disabled={isAuthActionLoading}>
          {activeAuthAction === 'logout' ? (
            <span className="button-loading-content">
              <span className="loading-spinner" aria-hidden="true" />
              Logging out...
            </span>
          ) : (
            'Logout'
          )}
        </button>

        <div className="settings-menu-shell" ref={settingsMenuRef}>
          <button
            type="button"
            className="button-secondary"
            onClick={onToggleSettingsMenu}
            aria-haspopup="menu"
            aria-expanded={isSettingsMenuOpen}
            disabled={isAuthActionLoading}
          >
            {isSettingsBusy ? (
              <span className="button-loading-content">
                <span className="loading-spinner" aria-hidden="true" />
                {activeAuthAction === 'refresh' ? 'Refreshing...' : 'Signing out...'}
              </span>
            ) : (
              'Settings'
            )}
          </button>

          {isSettingsMenuOpen && (
            <div className="settings-menu-popover" role="menu" aria-label="Account settings">
              <button
                type="button"
                className="settings-action"
                onClick={onRefreshToken}
                disabled={isAuthActionLoading}
                role="menuitem"
              >
                {activeAuthAction === 'refresh' ? (
                  <span className="button-loading-content">
                    <span className="loading-spinner" aria-hidden="true" />
                    Refreshing...
                  </span>
                ) : (
                  'Refresh Token'
                )}
              </button>
              <button
                type="button"
                className="settings-action danger"
                onClick={onLogoutAll}
                disabled={isAuthActionLoading}
                role="menuitem"
              >
                {activeAuthAction === 'logoutAll' ? (
                  <span className="button-loading-content">
                    <span className="loading-spinner" aria-hidden="true" />
                    Logging out...
                  </span>
                ) : (
                  'Logout All'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
