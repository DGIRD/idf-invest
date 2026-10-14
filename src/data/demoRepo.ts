/**
 * Mode démonstration : données stockées uniquement dans ce navigateur (localStorage).
 * Aucune sauvegarde en ligne, aucun e-mail, aucun paiement. Signalé en permanence dans l'interface.
 * Reproduit les règles serveur utiles (version, statut « acquis », historique) pour tester l'interface.
 */
import { applyStatusRules, statusEventSummary } from '../domain/property.ts';
import { RepoError, type Repo, type SessionInfo, type Snapshot, type UpdateResult } from './repo.ts';
import type { Insert, Patch, Property, Scenario, Tables, TableName, TimelineEvent, UserSettings, VersionedTable } from './types.ts';

const KEY = 'immozen:demo:v1';
const USER = '00000000-0000-4000-8000-000000000001';
const SESSION: SessionInfo = { userId: USER, email: 'demo@immo-zen.local' };

type Db = { [K in TableName]: Tables[K][] } & { user_settings: UserSettings };

function emptyDb(): Db {
  return {
    properties: [], scenarios: [], pro_contacts: [], property_tasks: [], timeline_events: [],
    user_settings: { user_id: USER, simulator_defaults: {}, ui_prefs: {}, version: 1, updated_at: new Date().toISOString() },
  };
}

const PROPERTY_DEFAULTS: Omit<Property, 'id' | 'user_id' | 'version' | 'created_at' | 'updated_at' | 'title'> = {
  status: 'repere', status_before_archive: null, occupation_status: null, property_type: 'appartement',
  address: null, zip: null, city: null, surface: null, rooms: null, dpe: null, listing_url: null,
  asking_price: null, offer_price: null, works_budget: null, estimated_rent: null, agency_id: null, agent_id: null,
  next_action: null, follow_up_date: null, visit_at: null, comments: null, vigilance: [], ownership_mode: null,
  tax_regime: null, acquired_at: null, acquisition_cost: null, acquisition_snapshot: null, primary_scenario_id: null,
  legacy_simulation_id: null, legacy_ref: null,
};
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  properties: PROPERTY_DEFAULTS,
  scenarios: { property_id: null, name: 'Scénario', inputs: {}, results: null, engine_version: '1', archived_at: null, legacy_simulation_id: null },
  pro_contacts: { kind: 'autre', organization_id: null, organization_name: null, email: null, phone: null, sector: null, notes: null, next_follow_up: null, archived_at: null, legacy_source: null },
  property_tasks: { due_date: null, done_at: null },
  timeline_events: { property_id: null, contact_id: null, channel: null, data: {} },
};

export function createDemoRepo(storage: Storage = localStorage): Repo {
  let listeners: ((s: SessionInfo | null, e: string) => void)[] = [];
  let signedIn = true;

  const read = (): Db => {
    try {
      const raw = storage.getItem(KEY);
      return raw ? { ...emptyDb(), ...(JSON.parse(raw) as Db) } : emptyDb();
    } catch {
      return emptyDb();
    }
  };
  const write = (db: Db) => storage.setItem(KEY, JSON.stringify(db));
  const now = () => new Date().toISOString();

  function logEvent(db: Db, e: Pick<TimelineEvent, 'property_id' | 'kind' | 'summary' | 'data'>) {
    db.timeline_events.push({ id: crypto.randomUUID(), user_id: USER, contact_id: null, channel: null, occurred_at: now(), created_at: now(), ...e });
  }

  function insertOne<T extends TableName>(db: Db, table: T, row: Insert<Tables[T]>): Tables[T] {
    const t = now();
    let rec = { ...(DEFAULTS[table] ?? {}), ...row, id: row.id ?? crypto.randomUUID(), user_id: USER, created_at: t } as Record<string, unknown>;
    if (table !== 'timeline_events') Object.assign(rec, { version: 1, updated_at: t });
    else rec.occurred_at = rec.occurred_at ?? t;
    if (table === 'timeline_events' && !['exchange', 'note', 'visit'].includes(String(rec.kind))) {
      throw new RepoError('Action refusée par le serveur (droits insuffisants).');
    }
    if (table === 'properties') {
      rec = applyStatusRules(null, rec as unknown as Property, db.scenarios) as unknown as Record<string, unknown>;
      const ev = statusEventSummary(null, (rec as unknown as Property).status);
      logEvent(db, { property_id: String(rec.id), kind: ev.kind, summary: ev.summary, data: { status: rec.status } });
    }
    (db[table] as unknown as Record<string, unknown>[]).push(rec);
    return structuredClone(rec) as unknown as Tables[T];
  }

  return {
    mode: 'demo',
    async getSession() { return signedIn ? SESSION : null; },
    onAuthChange(cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((l) => l !== cb); };
    },
    async signIn() { signedIn = true; listeners.forEach((l) => l(SESSION, 'SIGNED_IN')); },
    async signUp() { signedIn = true; listeners.forEach((l) => l(SESSION, 'SIGNED_IN')); return 'session'; },
    async signOut() { signedIn = false; listeners.forEach((l) => l(null, 'SIGNED_OUT')); },
    async requestPasswordReset() { throw new RepoError('Indisponible en mode démonstration (aucun e-mail n’est envoyé).'); },
    async updatePassword() { throw new RepoError('Indisponible en mode démonstration.'); },

    async loadAll(): Promise<Snapshot> {
      const db = read();
      return {
        properties: db.properties, scenarios: db.scenarios, contacts: db.pro_contacts, tasks: db.property_tasks,
        events: db.timeline_events, settings: db.user_settings, loadedAt: now(),
      };
    },
    async insert(table, row) {
      const db = read();
      const rec = insertOne(db, table, row);
      write(db);
      return rec;
    },
    async insertMany(table, rows) {
      const db = read();
      const out = rows.map((r) => insertOne(db, table, r));
      write(db);
      return out;
    },
    async update<T extends VersionedTable>(table: T, id: string, version: number, patch: Patch<Tables[T]>): Promise<UpdateResult<Tables[T]>> {
      const db = read();
      const list = db[table] as unknown as (Tables[T] & { version: number })[];
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return { status: 'missing' };
      const prev = list[idx]!;
      if (prev.version !== version) return { status: 'conflict', current: structuredClone(prev) };
      let next = { ...prev, ...patch, id: prev.id, user_id: prev.user_id, created_at: prev.created_at, version: prev.version + 1, updated_at: now() } as Tables[T];
      if (table === 'properties') {
        const p0 = prev as unknown as Property;
        const p1 = applyStatusRules(p0, next as unknown as Property, db.scenarios as Scenario[]);
        if (p1.status !== 'acquis' && p1.occupation_status) throw new RepoError('Une valeur ne respecte pas les règles de saisie.');
        next = p1 as unknown as Tables[T];
        if (p0.status !== p1.status) {
          const ev = statusEventSummary(p0.status, p1.status);
          logEvent(db, { property_id: p1.id, kind: ev.kind, summary: ev.summary, data: { from: p0.status, to: p1.status } });
        }
      }
      list[idx] = next;
      write(db);
      return { status: 'ok', row: structuredClone(next) };
    },
    async remove(table, id) {
      const db = read();
      (db[table] as unknown as { id: string }[]) = (db[table] as unknown as { id: string }[]).filter((r) => r.id !== id);
      if (table === 'properties') {
        db.scenarios = db.scenarios.filter((s) => s.property_id !== id);
        db.property_tasks = db.property_tasks.filter((t) => t.property_id !== id);
        db.timeline_events = db.timeline_events.filter((e) => e.property_id !== id);
      }
      if (table === 'pro_contacts') {
        db.properties.forEach((p) => { if (p.agency_id === id) p.agency_id = null; if (p.agent_id === id) p.agent_id = null; });
        db.pro_contacts.forEach((c) => { if (c.organization_id === id) c.organization_id = null; });
        db.timeline_events.forEach((e) => { if (e.contact_id === id) e.contact_id = null; });
      }
      if (table === 'scenarios') db.properties.forEach((p) => { if (p.primary_scenario_id === id) p.primary_scenario_id = null; });
      write(db);
    },
    async saveSettings(version, patch) {
      const db = read();
      if (db.user_settings.version !== version) return { status: 'conflict', current: db.user_settings };
      db.user_settings = { ...db.user_settings, ...patch, version: version + 1, updated_at: now() };
      write(db);
      return { status: 'ok', row: db.user_settings };
    },
  };
}

export function resetDemo(storage: Storage = localStorage) {
  storage.removeItem(KEY);
}
