import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AppLoadingScreen } from './components/AppLoadingScreen';
import { LoginPage } from './pages/auth/LoginPage';
import { supabase } from '../lib/supabaseClient';
import { projectId, supabaseUrl } from '/utils/supabase/info';
import { Session } from '@supabase/supabase-js';
import { getAppRouteByPath, getCanonicalAppPath } from '@/app/routing/appRouteRegistry';
import {
  getAuthErrorMessage,
  isFatalSessionError,
  isRetryableAuthError,
} from '@/app/services/internal/authErrorUtils';

const DEFAULT_AUTHENTICATED_PATH = '/dashboard/';
// Login must not download the data providers and operational workspace.
const AuthenticatedWorkspace = React.lazy(() => import('./AuthenticatedWorkspace'));
const LOGIN_REDIRECT_STORAGE_KEY = 'app_post_login_redirect';
const LOCAL_AUTH_SESSION_KEY = 'rhi-v2-local-session';
const useLocalAuth = import.meta.env.VITE_AUTH_MODE === 'local';

const expectedSupabaseIssuer = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1` : '';

const decodeJwtPayload = (token?: string | null) => {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    );
    return JSON.parse(window.atob(paddedPayload)) as { iss?: string; exp?: number };
  } catch {
    return null;
  }
};

const isSessionForCurrentProject = (session?: Session | null) => {
  if (!session?.access_token || !expectedSupabaseIssuer) return Boolean(session?.access_token);
  return decodeJwtPayload(session.access_token)?.iss === expectedSupabaseIssuer;
};

const parseStoredSession = (raw: string) => {
  const parsed = JSON.parse(raw);
  return (parsed?.currentSession || parsed?.session || (Array.isArray(parsed) ? parsed[0] : parsed)) as Session | null;
};

const hasCachedSupabaseSession = () => {
  if (typeof window === 'undefined') return false;
  return Object.keys(window.localStorage).some((key) => {
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) return false;
    try {
      return isSessionForCurrentProject(parseStoredSession(window.localStorage.getItem(key) || ''));
    } catch {
      return false;
    }
  });
};

const readCachedSupabaseSession = (): Session | null => {
  if (typeof window === 'undefined') return null;

  const candidateKeys = [
    projectId ? `sb-${projectId}-auth-token` : '',
    ...Object.keys(window.localStorage).filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token')),
  ].filter(Boolean);

  for (const key of Array.from(new Set(candidateKeys))) {
    if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const session = parseStoredSession(raw);
      if (!session?.access_token) continue;
      if (!isSessionForCurrentProject(session)) continue;

      const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
      if (expiresAtMs && expiresAtMs <= Date.now()) continue;

      return session;
    } catch (error) {
      console.warn('Failed to read cached Supabase session.', error);
    }
  }

  return null;
};

const withAuthTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => (
  new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  })
);

const isAuthTimeoutError = (error: unknown) =>
  error instanceof Error && error.message.toLowerCase().includes('timed out');

const isRecoverableAuthBootError = (error: unknown) =>
  isRetryableAuthError(error) || isAuthTimeoutError(error);

const createLocalSession = (): Session => {
  const email = localStorage.getItem('rhi-v2-local-email') || 'owner@polesheadlamp.id';
  const now = Math.floor(Date.now() / 1000);

  return {
    access_token: 'local-v2-access-token',
    refresh_token: 'local-v2-refresh-token',
    expires_in: 60 * 60 * 24,
    expires_at: now + 60 * 60 * 24,
    token_type: 'bearer',
    user: {
      id: 'local-owner',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'local', providers: ['local'] },
      user_metadata: { name: 'Owner Polesheadlamp' },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  };
};

export const AuthenticatedApp = () => {
  const location = useLocation();
  const currentRoute = getAppRouteByPath(location.pathname);
  const canonicalPath = currentRoute ? getCanonicalAppPath(currentRoute) : location.pathname;
  const lastStableSessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (useLocalAuth) {
      const localSessionEnabled = localStorage.getItem(LOCAL_AUTH_SESSION_KEY) === 'active';
      setSession(localSessionEnabled ? createLocalSession() : null);
      setLoading(false);
      return;
    }

    let isActive = true;
    const AUTH_BOOT_TIMEOUT_MS = 12000;
    const AUTH_REQUEST_TIMEOUT_MS = 6000;
    const AUTH_RETRY_DELAY_MS = 1500;
    const MAX_AUTH_RETRIES = 1;
    let usedBootCachedSession = false;

    const settleAuthState = (nextSession: Session | null) => {
      if (!isActive) return;

      const validNextSession = isSessionForCurrentProject(nextSession) ? nextSession : null;
      if (validNextSession?.access_token) {
        lastStableSessionRef.current = validNextSession;
        setSession(validNextSession);
        setLoading(false);
        return;
      }

      const cachedSession = readCachedSupabaseSession();
      if (cachedSession?.access_token) {
        lastStableSessionRef.current = cachedSession;
        setSession(cachedSession);
        setLoading(false);
        return;
      }

      lastStableSessionRef.current = null;
      setSession(null);
      setLoading(false);
    };

    const settleCachedAuthState = () => {
      settleAuthState(readCachedSupabaseSession());
    };

    const handleAuthError = (error: unknown, retry?: () => void, attempt = 0) => {
      if (!isActive) return;

      const message = getAuthErrorMessage(error);

      if (isRecoverableAuthBootError(error) && hasCachedSupabaseSession()) {
        console.warn('Network connection issue during auth check. Opening cached session while auth recovers.', message);
        settleCachedAuthState();
        if (retry && attempt < MAX_AUTH_RETRIES) {
          window.setTimeout(retry, AUTH_RETRY_DELAY_MS);
        }
        return;
      }

      if (isRecoverableAuthBootError(error) && retry && attempt < MAX_AUTH_RETRIES) {
        console.warn(`Network connection issue during auth check. Retrying (${attempt + 1}/${MAX_AUTH_RETRIES}).`, message);
        window.setTimeout(retry, AUTH_RETRY_DELAY_MS);
        return;
      }

      if (!isRecoverableAuthBootError(error)) {
        console.error('Unexpected auth error:', error);
        settleAuthState(null);
        return;
      }

      console.warn('Network connection issue during auth check. Keeping cached login instead of forcing logout.');
      settleCachedAuthState();
    };

    const resolveValidSession = async (nextSession: Session | null) => {
      if (!nextSession?.access_token) {
        settleAuthState(null);
        return;
      }

      const expiresAtMs = nextSession.expires_at ? nextSession.expires_at * 1000 : 0;
      const shouldRefresh = !expiresAtMs || expiresAtMs - Date.now() < 60_000;

      if (!shouldRefresh) {
        settleAuthState(nextSession);
        return;
      }

      let refreshResult: Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
      try {
        refreshResult = await withAuthTimeout(
          supabase.auth.refreshSession(),
          AUTH_REQUEST_TIMEOUT_MS,
          'Auth session refresh timed out',
        );
      } catch (refreshError) {
        if (isRecoverableAuthBootError(refreshError)) {
          console.warn('Session refresh timed out. Keeping cached session active.', refreshError);
          settleAuthState(nextSession);
          return;
        }

        console.error('Unexpected session refresh error:', refreshError);
        settleAuthState(null);
        return;
      }

      const {
        data: { session: refreshedSession },
        error: refreshError,
      } = refreshResult;

      if (!refreshError && refreshedSession?.access_token) {
        settleAuthState(refreshedSession);
        return;
      }

      if (refreshError && isRecoverableAuthBootError(refreshError)) {
        console.warn('Session refresh temporarily failed. Keeping cached session active.', refreshError.message);
        settleAuthState(nextSession);
        return;
      }

      settleAuthState(null);
    };

    const bootTimeout = window.setTimeout(() => {
      if (!isActive) return;
      console.warn('Auth bootstrap timed out. Falling back to cached session if available.');
      settleCachedAuthState();
    }, AUTH_BOOT_TIMEOUT_MS);

    // 1. Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      window.clearTimeout(bootTimeout);
      if (!session && (usedBootCachedSession || lastStableSessionRef.current) && hasCachedSupabaseSession()) {
        return;
      }
      settleAuthState(session);
    });

    const cachedSessionAtBoot = readCachedSupabaseSession();
    if (cachedSessionAtBoot) {
      usedBootCachedSession = true;
      settleAuthState(cachedSessionAtBoot);
    }

    // 2. Check active session
    const checkActiveSession = (attempt = 0) => {
      withAuthTimeout(
        supabase.auth.getSession(),
        AUTH_REQUEST_TIMEOUT_MS,
        'Auth session check timed out',
      )
      .then(({ data: { session }, error }) => {
        window.clearTimeout(bootTimeout);

        if (error) {
          if (isRecoverableAuthBootError(error)) {
            console.warn('Network error during session check. Not clearing auth session:', error.message);
            if (hasCachedSupabaseSession()) {
              settleCachedAuthState();
              if (attempt < MAX_AUTH_RETRIES) {
                window.setTimeout(() => checkActiveSession(attempt + 1), AUTH_RETRY_DELAY_MS);
              }
              return;
            }
            if (attempt < MAX_AUTH_RETRIES) {
              window.setTimeout(() => checkActiveSession(attempt + 1), AUTH_RETRY_DELAY_MS);
              return;
            }
          } else {
            console.error('Error getting session:', error.message);
          }
          settleAuthState(isFatalSessionError(error) ? null : session);
          return;
        }

        void resolveValidSession(session);
      })
      .catch((err) => {
        window.clearTimeout(bootTimeout);
        handleAuthError(err, () => checkActiveSession(attempt + 1), attempt);
      });
    };

    checkActiveSession();

    return () => {
      isActive = false;
      window.clearTimeout(bootTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // 3. Auto-logout on 24h inactivity
  useEffect(() => {
    if (!session) return;

    const TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
    const ACTIVITY_KEY = 'app_last_active';

    const updateActivity = () => {
      localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
    };

    const checkInactivity = () => {
      const lastActive = localStorage.getItem(ACTIVITY_KEY);
      const now = Date.now();
      
      if (lastActive && (now - Number(lastActive) > TIMEOUT_MS)) {
        console.log("Session expired due to inactivity (24h)");
        localStorage.removeItem(ACTIVITY_KEY);
        supabase.auth.signOut();
        setSession(null);
      }
    };

    const lastActive = localStorage.getItem(ACTIVITY_KEY);
    if (!lastActive) {
      updateActivity();
    }

    checkInactivity();

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    const handleActivity = () => {
        const lastActive = localStorage.getItem(ACTIVITY_KEY);
        if (!lastActive || Date.now() - Number(lastActive) > 60000) {
            updateActivity();
        }
    };

    events.forEach(event => window.addEventListener(event, handleActivity));
    const interval = setInterval(checkInactivity, 60000);

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      clearInterval(interval);
    };
  }, [session]);

  if (canonicalPath !== location.pathname) {
    return <Navigate to={canonicalPath} replace />;
  }

  if (loading) {
    return <AppLoadingScreen />;
  }

  if (!session && currentRoute?.id !== 'login') {
    const intendedPath = `${location.pathname}${location.search}${location.hash}`;
    if (intendedPath && intendedPath !== '/login') {
      sessionStorage.setItem(LOGIN_REDIRECT_STORAGE_KEY, intendedPath);
    }
    return <Navigate to="/login" replace />;
  }

  if (!session) {
    return <LoginPage />;
  }

  if (currentRoute?.id === 'login') {
    const storedRedirect = sessionStorage.getItem(LOGIN_REDIRECT_STORAGE_KEY);
    sessionStorage.removeItem(LOGIN_REDIRECT_STORAGE_KEY);
    const nextPath = storedRedirect?.startsWith('/') && !storedRedirect.startsWith('/login')
      ? storedRedirect
      : DEFAULT_AUTHENTICATED_PATH;
    return <Navigate to={nextPath} replace />;
  }

  return (
    <React.Suspense fallback={<AppLoadingScreen />}>
      <AuthenticatedWorkspace key={session.user.id} session={session} activePath={canonicalPath} />
    </React.Suspense>
  );
};

export default AuthenticatedApp;
