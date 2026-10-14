/**
 * Sauvegarde JSON complète et import avec aperçu, validation et gestion des doublons.
 * L'import crée de nouveaux identifiants (aucune collision possible avec d'autres comptes)
 * et réécrit les liens internes (agence d'un bien, bien d'un scénario…).
 */
import type { Snapshot } from '../data/repo.ts';
import type { Contact, Insert, Property, PropertyTask, Scenario, TimelineEvent } from '../data/types.ts';

export const BACKUP_FORMAT = 'immo-zen-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  account: string;
  data: {
    properties: Property[];
    scenarios: Scenario[];
    contacts: Contact[];
    tasks: PropertyTask[];
    events: TimelineEvent[];
  };
  /** Gestion locative (lot 2) : exportée pour archivage ; la réimportation sera ajoutée ultérieurement. */
  rental?: Pick<Snapshot, 'tenants' | 'leases' | 'leaseTenants' | 'charges' | 'payments' | 'allocations' | 'deposits' | 'receipts' | 'reminders' | 'documents' | 'expenses'>;
}

export function buildBackup(s: Snapshot, account: string, now = new Date()): Backup {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: now.toISOString(), account,
    data: { properties: s.properties, scenarios: s.scenarios, contacts: s.contacts, tasks: s.tasks, events: s.events },
    rental: {
      tenants: s.tenants, leases: s.leases, leaseTenants: s.leaseTenants, charges: s.charges, payments: s.payments, allocations: s.allocations,
      deposits: s.deposits, receipts: s.receipts, reminders: s.reminders, documents: s.documents, expenses: s.expenses,
    },
  };
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'Fichier JSON illisible.' }; }
  const b = raw as Partial<Backup>;
  if (!b || b.format !== BACKUP_FORMAT) return { ok: false, error: 'Ce fichier n’est pas une sauvegarde Immo-Zen.' };
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) return { ok: false, error: 'Version de sauvegarde non prise en charge.' };
  const d = b.data;
  const arrays = ['properties', 'scenarios', 'contacts', 'tasks', 'events'] as const;
  if (!d || arrays.some((k) => !Array.isArray(d[k]))) return { ok: false, error: 'Sauvegarde incomplète.' };
  for (const p of d.properties) if (!p || typeof p.id !== 'string' || typeof p.title !== 'string' || !p.title.trim()) return { ok: false, error: 'Un bien sans titre ou sans identifiant a été trouvé.' };
  for (const c of d.contacts) if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim()) return { ok: false, error: 'Un contact sans nom a été trouvé.' };
  for (const s of d.scenarios) if (!s || typeof s.id !== 'string' || typeof s.inputs !== 'object') return { ok: false, error: 'Un scénario invalide a été trouvé.' };
  return { ok: true, backup: b as Backup };
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
export const contactKey = (c: Pick<Contact, 'kind' | 'name' | 'email'>) => `${c.kind}|${norm(c.name)}|${norm(c.email)}`;
export const propertyKey = (p: Pick<Property, 'title' | 'city' | 'asking_price' | 'legacy_simulation_id'>) =>
  p.legacy_simulation_id ? `legacy|${p.legacy_simulation_id}` : `${norm(p.title)}|${norm(p.city)}|${p.asking_price ?? ''}`;

export interface ImportPlan {
  contacts: { add: Contact[]; duplicates: { incoming: Contact; existing: Contact }[] };
  properties: { add: Property[]; duplicates: { incoming: Property; existing: Property }[] };
  scenarios: Scenario[];
  tasks: PropertyTask[];
  events: TimelineEvent[];
}

/** Aperçu : ce qui sera ajouté, ce qui est déjà présent (doublons ignorés). */
export function planImport(b: Backup, current: Snapshot): ImportPlan {
  const existingC = new Map(current.contacts.map((c) => [contactKey(c), c]));
  const existingP = new Map(current.properties.map((p) => [propertyKey(p), p]));
  const plan: ImportPlan = { contacts: { add: [], duplicates: [] }, properties: { add: [], duplicates: [] }, scenarios: [], tasks: [], events: [] };
  const seenC = new Set<string>();
  for (const c of b.data.contacts) {
    const k = contactKey(c);
    const ex = existingC.get(k);
    if (ex) plan.contacts.duplicates.push({ incoming: c, existing: ex });
    else if (!seenC.has(k)) { plan.contacts.add.push(c); seenC.add(k); }
  }
  const seenP = new Set<string>();
  for (const p of b.data.properties) {
    const k = propertyKey(p);
    const ex = existingP.get(k);
    if (ex) plan.properties.duplicates.push({ incoming: p, existing: ex });
    else if (!seenP.has(k)) { plan.properties.add.push(p); seenP.add(k); }
  }
  const added = new Set(plan.properties.add.map((p) => p.id));
  plan.scenarios = b.data.scenarios.filter((s) => s.property_id === null || added.has(s.property_id));
  plan.tasks = b.data.tasks.filter((t) => added.has(t.property_id));
  // seuls les échanges et notes saisis à la main sont réimportés (l'historique système est recréé par le serveur)
  plan.events = b.data.events.filter((e) => ['exchange', 'note', 'visit'].includes(e.kind) && (e.property_id === null || added.has(e.property_id)));
  return plan;
}

export interface ImportRows {
  agencies: Insert<Contact>[];
  otherContacts: Insert<Contact>[];
  properties: Insert<Property>[];
  scenarios: Insert<Scenario>[];
  tasks: Insert<PropertyTask>[];
  events: Insert<TimelineEvent>[];
  /** ancien id de bien → id du scénario principal (nouveaux ids) */
  primary: Map<string, string>;
}

/** Construit les lignes à insérer avec de nouveaux identifiants et des liens réécrits. */
export function materialize(plan: ImportPlan, newId: () => string = () => crypto.randomUUID()): ImportRows {
  const cMap = new Map<string, string>();
  for (const d of plan.contacts.duplicates) cMap.set(d.incoming.id, d.existing.id);
  for (const c of plan.contacts.add) cMap.set(c.id, newId());
  const pMap = new Map<string, string>();
  for (const d of plan.properties.duplicates) pMap.set(d.incoming.id, d.existing.id);
  for (const p of plan.properties.add) pMap.set(p.id, newId());
  const sMap = new Map<string, string>();
  for (const s of plan.scenarios) sMap.set(s.id, newId());

  const strip = <T extends { id: string; user_id?: string; version?: number; created_at?: string; updated_at?: string }>(r: T) => {
    const { user_id: _u, version: _v, created_at: _c, updated_at: _up, ...rest } = r;
    return rest;
  };
  const contact = (c: Contact): Insert<Contact> => ({ ...strip(c), id: cMap.get(c.id)!, organization_id: c.organization_id ? cMap.get(c.organization_id) ?? null : null });
  const primary = new Map<string, string>();
  const properties = plan.properties.add.map((p): Insert<Property> => {
    if (p.primary_scenario_id && sMap.has(p.primary_scenario_id)) primary.set(pMap.get(p.id)!, sMap.get(p.primary_scenario_id)!);
    return {
      ...strip(p), id: pMap.get(p.id)!, primary_scenario_id: null, legacy_simulation_id: p.legacy_simulation_id ?? null,
      agency_id: p.agency_id ? cMap.get(p.agency_id) ?? null : null,
      agent_id: p.agent_id ? cMap.get(p.agent_id) ?? null : null,
    };
  });
  return {
    agencies: plan.contacts.add.filter((c) => c.kind === 'agence').map((c) => ({ ...contact(c), organization_id: null })),
    otherContacts: plan.contacts.add.filter((c) => c.kind !== 'agence').map(contact),
    properties,
    scenarios: plan.scenarios.map((s) => ({ ...strip(s), id: sMap.get(s.id)!, property_id: s.property_id ? pMap.get(s.property_id) ?? null : null, legacy_simulation_id: null })),
    tasks: plan.tasks.map((t) => ({ ...strip(t), id: newId(), property_id: pMap.get(t.property_id)! })),
    events: plan.events.map((e) => {
      const { user_id: _u, created_at: _c, ...rest } = e;
      return { ...rest, id: newId(), property_id: e.property_id ? pMap.get(e.property_id) ?? null : null, contact_id: e.contact_id ? cMap.get(e.contact_id) ?? null : null };
    }),
    primary,
  };
}
