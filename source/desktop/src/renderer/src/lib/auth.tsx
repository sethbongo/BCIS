import type { AuthUser, Permission } from '@bcis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onSessionEvent } from './api';

interface AuthState {
  user: AuthUser | null;
  locked: boolean;
  loading: boolean;
  /** UI convenience only: the server re-checks every permission on every request. */
  can: (...anyOf: Permission[]) => boolean;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [idleMinutes, setIdleMinutes] = useState(10);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    void window.bcis.auth.current().then((session) => {
      if (session) {
        setUser(session.user);
        setLocked(session.locked);
        setIdleMinutes(session.idleLockMinutes);
      }
      setLoading(false);
    });
    return onSessionEvent((event) => {
      if (event === 'locked') setLocked(true);
      else {
        setUser(null);
        setLocked(false);
        queryClient.clear();
      }
    });
  }, [queryClient]);

  const lock = useCallback(async () => {
    setLocked(true);
    await api.post('/auth/lock').catch(() => undefined);
  }, []);

  // Idle lock: no keyboard or mouse activity for the configured time locks the session.
  useEffect(() => {
    if (!user || locked) return;
    const touch = () => (lastActivity.current = Date.now());
    touch();
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > idleMinutes * 60_000) void lock();
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [user, locked, idleMinutes, lock]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      locked,
      loading,
      can: (...anyOf) => !!user && anyOf.some((p) => user.permissions.includes(p)),
      async login(username, password) {
        const result = await window.bcis.auth.login({ username, password });
        if (!result.ok) return result.error.message;
        queryClient.clear();
        // Every sign-in starts at the user's own home screen, not where the last user left off.
        window.location.hash = '#/';
        setUser(result.data.user);
        setIdleMinutes(result.data.idleLockMinutes);
        setLocked(false);
        return null;
      },
      async logout() {
        await window.bcis.auth.logout();
        setUser(null);
        setLocked(false);
        queryClient.clear();
      },
      lock,
      async unlock(password) {
        try {
          await api.post('/auth/unlock', { password });
          setLocked(false);
          lastActivity.current = Date.now();
          return null;
        } catch (err) {
          return err instanceof Error ? err.message : 'Could not unlock.';
        }
      },
    }),
    [user, locked, loading, lock, queryClient],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
