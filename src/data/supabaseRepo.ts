import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RepoError, type Repo, type SessionInfo, type Snapshot, type UpdateResult } from './repo.ts';
import type { Insert, Patch, Tables, TableName, UserSettings, VersionedTable } from './types.ts';

const PAGE = 1000;

export function createSupabaseRepo(url: string, anonKey: string): Repo {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  const toSession = (s: { user: { id: string; email?: string } } | null): SessionInfo | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '' } : null;

  function check<R extends { data: unknown; error: { message: string } | null }>(res: R): R['data'] {
    if (res.error) throw new RepoError(res.error.message, res.error, !navigator.onLine);
    return res.data;
  }

  async function selectAll<T extends TableName>(table: T, order = 'created_at'): Promise<Tables[T][]> {
    const out: Tables[T][] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = check(await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1)) as Tables[T][];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  return {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => cb(toSession(session), event));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password) {
      const data = check(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
      return data?.session ? 'session' : 'confirm_email';
    },
    async signOut() {
      await sb.auth.signOut({ scope: 'local' });
    },
    async requestPasswordReset(email) {
      check(await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#/nouveau-mot-de-passe` }));
    },
    async updatePassword(password) {
      check(await sb.auth.updateUser({ password }));
    },

    async loadAll(): Promise<Snapshot> {
      const [properties, scenarios, contacts, tasks, events, settings] = await Promise.all([
        selectAll('properties'),
        selectAll('scenarios'),
        selectAll('pro_contacts'),
        selectAll('property_tasks'),
        selectAll('timeline_events', 'occurred_at'),
        sb.from('user_settings').select('*').maybeSingle().then((r) => check(r) as UserSettings | null),
      ]);
      return { properties, scenarios, contacts, tasks, events, settings, loadedAt: new Date().toISOString() };
    },

    async insert(table, row) {
      return check(await sb.from(table).insert(row as never).select('*').single()) as never;
    },
    async insertMany(table, rows) {
      if (!rows.length) return [];
      return check(await sb.from(table).insert(rows as never).select('*')) as never;
    },

    async update<T extends VersionedTable>(table: T, id: string, version: number, patch: Patch<Tables[T]>): Promise<UpdateResult<Tables[T]>> {
      const row = check(await sb.from(table).update(patch as never).eq('id', id).eq('version', version).select('*').maybeSingle()) as Tables[T] | null;
      if (row) return { status: 'ok', row };
      const current = check(await sb.from(table).select('*').eq('id', id).maybeSingle()) as Tables[T] | null;
      return current ? { status: 'conflict', current } : { status: 'missing' };
    },

    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },

    async saveSettings(version, patch) {
      const session = await this.getSession();
      if (!session) throw new RepoError('Session expirée.');
      const row = check(await sb.from('user_settings').update(patch).eq('user_id', session.userId).eq('version', version).select('*').maybeSingle()) as UserSettings | null;
      if (row) return { status: 'ok', row };
      const current = check(await sb.from('user_settings').select('*').eq('user_id', session.userId).maybeSingle()) as UserSettings | null;
      if (current) return { status: 'conflict', current };
      // Compte créé avant la migration et sans ligne de paramètres : création.
      const created = check(await sb.from('user_settings').insert({ user_id: session.userId, ...patch }).select('*').single()) as UserSettings;
      return { status: 'ok', row: created };
    },
  };
}

export type { Insert };
