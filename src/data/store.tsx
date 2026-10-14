import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_INPUTS, normalizeInputs, type SimulationInputs } from '../domain/simulator.ts';
import { describeError, RepoError, type Repo, type SessionInfo, type Snapshot } from './repo.ts';
import type { Insert, Patch, Tables, TableName, UserSettings, VersionedTable } from './types.ts';

export type SyncState = 'loading' | 'synced' | 'saving' | 'offline' | 'error';

export interface ConflictRequest {
  table: VersionedTable;
  label: string;
  resolve: (choice: 'reload' | 'overwrite') => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error' | 'info';
}

interface StoreValue {
  repo: Repo;
  session: SessionInfo | null;
  authReady: boolean;
  data: Snapshot;
  sync: { state: SyncState; message?: string; lastSync?: string };
  conflict: ConflictRequest | null;
  toasts: Toast[];
  simulatorDefaults: SimulationInputs;
  notify(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  refresh(): Promise<void>;
  create<T extends TableName>(table: T, row: Insert<Tables[T]>): Promise<Tables[T] | null>;
  createMany<T extends TableName>(table: T, rows: Insert<Tables[T]>[]): Promise<Tables[T][] | null>;
  update<T extends VersionedTable>(table: T, current: Tables[T], patch: Patch<Tables[T]>, label?: string): Promise<Tables[T] | null>;
  remove(table: TableName, id: string): Promise<boolean>;
  saveSettings(patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs'>>): Promise<boolean>;
  signOut(): Promise<void>;
}

const EMPTY: Snapshot = { properties: [], scenarios: [], contacts: [], tasks: [], events: [], settings: null, loadedAt: '' };
const CACHE_PREFIX = 'immozen:cache:';
const Ctx = createContext<StoreValue | null>(null);

const listKey: Record<TableName, keyof Omit<Snapshot, 'settings' | 'loadedAt'>> = {
  properties: 'properties', scenarios: 'scenarios', pro_contacts: 'contacts', property_tasks: 'tasks', timeline_events: 'events',
};

/** Supprime toute copie locale de données privées (déconnexion). */
export function purgePrivateCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
    sessionStorage.clear();
  } catch { /* stockage indisponible */ }
}

export function StoreProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [sync, setSync] = useState<StoreValue['sync']>({ state: 'loading' });
  const [conflict, setConflict] = useState<ConflictRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const lastRefresh = useRef(0);
  const sessionRef = useRef<SessionInfo | null>(null);
  sessionRef.current = session;

  const notify = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const persist = useCallback((snap: Snapshot) => {
    const s = sessionRef.current;
    if (!s || repo.mode === 'demo') return;
    try { localStorage.setItem(CACHE_PREFIX + s.userId, JSON.stringify(snap)); } catch { /* quota */ }
  }, [repo.mode]);

  const commit = useCallback((fn: (d: Snapshot) => Snapshot) => {
    setData((d) => {
      const next = fn(d);
      persist(next);
      return next;
    });
  }, [persist]);

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    lastRefresh.current = Date.now();
    if (!navigator.onLine && repo.mode !== 'demo') {
      setSync({ state: 'offline', message: 'Hors connexion : consultation seule des données déjà chargées.' });
      return;
    }
    setSync((x) => ({ ...x, state: 'loading' }));
    try {
      const snap = await repo.loadAll();
      setData(snap);
      persist(snap);
      setSync({ state: 'synced', lastSync: snap.loadedAt });
    } catch (e) {
      setSync({ state: navigator.onLine ? 'error' : 'offline', message: describeError(e) });
    }
  }, [repo, persist]);

  // Session
  useEffect(() => {
    let alive = true;
    repo.getSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setAuthReady(true);
    }).catch(() => setAuthReady(true));
    const off = repo.onAuthChange((s, event) => {
      setSession((prev) => (prev?.userId === s?.userId ? prev : s));
      if (event === 'SIGNED_OUT') { setData(EMPTY); purgePrivateCache(); }
    });
    return () => { alive = false; off(); };
  }, [repo]);

  // Chargement initial : cache local pour un affichage immédiat, puis serveur
  useEffect(() => {
    if (!session) return;
    if (repo.mode !== 'demo') {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + session.userId);
        if (raw) setData(JSON.parse(raw) as Snapshot);
      } catch { /* cache illisible : ignoré */ }
    }
    void refresh();
  }, [session?.userId, repo, refresh]);

  // Reprise après coupure / retour sur l'onglet
  useEffect(() => {
    const online = () => { notify('Connexion rétablie : synchronisation…', 'info'); void refresh(); };
    const offline = () => setSync({ state: 'offline', message: 'Hors connexion : consultation seule des données déjà chargées.' });
    const visible = () => { if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 30000) void refresh(); };
    addEventListener('online', online);
    addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => { removeEventListener('online', online); removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, notify]);

  const guard = useCallback(() => {
    if (!navigator.onLine && repo.mode !== 'demo') {
      throw new RepoError('Hors connexion : la modification n’a pas été enregistrée. Réessayez une fois la connexion rétablie.', undefined, true);
    }
  }, [repo.mode]);

  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | null> => {
    try {
      guard();
      setSync((x) => ({ ...x, state: 'saving' }));
      const r = await fn();
      setSync({ state: 'synced', lastSync: new Date().toISOString() });
      return r;
    } catch (e) {
      const message = describeError(e);
      setSync({ state: navigator.onLine ? 'error' : 'offline', message });
      notify(message, 'error');
      return null;
    }
  }, [guard, notify]);

  const upsertLocal = useCallback(<T extends TableName>(table: T, rows: Tables[T][]) => {
    const key = listKey[table];
    commit((d) => {
      const list = [...(d[key] as unknown as { id: string }[])];
      for (const row of rows as unknown as { id: string }[]) {
        const i = list.findIndex((x) => x.id === row.id);
        if (i >= 0) list[i] = row; else list.push(row);
      }
      return { ...d, [key]: list };
    });
  }, [commit]);

  const create = useCallback(async <T extends TableName>(table: T, row: Insert<Tables[T]>) => {
    const rec = await run(() => repo.insert(table, row));
    if (rec) {
      upsertLocal(table, [rec]);
      // les déclencheurs serveur ajoutent de l'historique : on le relit sans bloquer
      if (table === 'properties') void repo.loadAll().then((s) => commit((d) => ({ ...d, events: s.events }))).catch(() => undefined);
    }
    return rec;
  }, [repo, run, upsertLocal, commit]);

  const createMany = useCallback(async <T extends TableName>(table: T, rows: Insert<Tables[T]>[]) => {
    const recs = await run(() => repo.insertMany(table, rows));
    if (recs) upsertLocal(table, recs);
    return recs;
  }, [repo, run, upsertLocal]);

  const askConflict = useCallback((table: VersionedTable, label: string) =>
    new Promise<'reload' | 'overwrite'>((resolve) => setConflict({ table, label, resolve: (c) => { setConflict(null); resolve(c); } })), []);

  const update = useCallback(async <T extends VersionedTable>(table: T, current: Tables[T], patch: Patch<Tables[T]>, label = 'Cet élément') => {
    let version = current.version;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await run(() => repo.update(table, current.id, version, patch));
      if (!res) return null;
      if (res.status === 'ok') {
        upsertLocal(table, [res.row]);
        if (table === 'properties' && 'status' in patch) {
          void repo.loadAll().then((s) => commit((d) => ({ ...d, events: s.events }))).catch(() => undefined);
        }
        return res.row;
      }
      if (res.status === 'missing') {
        notify(`${label} a été supprimé entre-temps.`, 'error');
        void refresh();
        return null;
      }
      setSync({ state: 'error', message: 'Conflit de modification' });
      const choice = await askConflict(table, label);
      if (choice === 'reload') {
        upsertLocal(table, [res.current]);
        setSync({ state: 'synced' });
        notify('Version enregistrée rechargée : vos modifications n’ont pas été appliquées.', 'info');
        return null;
      }
      version = res.current.version; // écrasement explicitement choisi
    }
    return null;
  }, [repo, run, upsertLocal, askConflict, notify, refresh, commit]);

  const remove = useCallback(async (table: TableName, id: string) => {
    const ok = await run(async () => { await repo.remove(table, id); return true; });
    if (ok) {
      commit((d) => {
        const key = listKey[table];
        const next: Snapshot = { ...d, [key]: (d[key] as unknown as { id: string }[]).filter((x) => x.id !== id) };
        if (table === 'properties') {
          next.scenarios = next.scenarios.filter((s) => s.property_id !== id);
          next.tasks = next.tasks.filter((t) => t.property_id !== id);
          next.events = next.events.filter((e) => e.property_id !== id);
        }
        if (table === 'pro_contacts') {
          next.properties = next.properties.map((p) => ({ ...p, agency_id: p.agency_id === id ? null : p.agency_id, agent_id: p.agent_id === id ? null : p.agent_id }));
        }
        return next;
      });
    }
    return !!ok;
  }, [repo, run, commit]);

  const saveSettings = useCallback(async (patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs'>>) => {
    const version = data.settings?.version ?? 1;
    const res = await run(() => repo.saveSettings(version, patch));
    if (!res) return false;
    if (res.status === 'ok') { commit((d) => ({ ...d, settings: res.row })); return true; }
    if (res.status === 'conflict') {
      commit((d) => ({ ...d, settings: res.current }));
      notify('Paramètres modifiés ailleurs : la dernière version a été rechargée, refaites votre modification.', 'error');
    }
    return false;
  }, [data.settings?.version, repo, run, commit, notify]);

  const signOut = useCallback(async () => {
    await repo.signOut();
    purgePrivateCache();
    setData(EMPTY);
    setSession(null);
  }, [repo]);

  const simulatorDefaults = useMemo(() => normalizeInputs(data.settings?.simulator_defaults ?? {}, DEFAULT_INPUTS), [data.settings]);

  const value: StoreValue = {
    repo, session, authReady, data, sync, conflict, toasts, simulatorDefaults,
    notify, dismissToast, refresh, create, createMany, update, remove, saveSettings, signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider manquant');
  return v;
}
