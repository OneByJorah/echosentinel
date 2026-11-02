import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onUnauthorized } from '../lib/api';
import { hasRole } from '../lib/format';
import type { Meta, Role, User } from '../lib/types';

interface AuthCtx {
  meta: Meta | undefined;
  metaError: unknown;
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (role: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: 60_000, retry: 2 });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<User>('/auth/me')
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        qc.clear();
      }),
    [qc],
  );

  const login = useCallback(async (username: string, password: string) => {
    const u = await api<User>('/auth/login', { method: 'POST', body: { username, password } });
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    setUser(null);
    qc.clear();
  }, [qc]);

  const can = useCallback((role: Role) => hasRole(user?.role, role), [user]);

  return <Ctx.Provider value={{ meta: meta.data, metaError: meta.error, user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
