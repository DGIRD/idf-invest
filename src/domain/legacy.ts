/**
 * Reprise des simulations IDF Invest restées uniquement dans le navigateur
 * (clé localStorage « idf-invest-v6:<id utilisateur> » de l'ancienne application).
 * Même logique que la fonction SQL immozen_backup.migrate_idf_invest().
 */
import type { Contact, Insert, Property, PropertyStatus, PropertyType } from '../data/types.ts';
import type { SimulationInputs } from './simulator.ts';

export interface LegacySimulation {
  id: string;
  number?: string;
  version?: number;
  archived?: boolean;
  createdAt?: string;
  [k: string]: unknown;
}

const STATUS: Record<string, PropertyStatus> = {
  'Brouillon': 'repere', 'Active': 'repere', 'À approfondir': 'informations_demandees', 'Visite programmée': 'visite_programmee',
  'Offre en cours': 'offre_transmise', 'Retenue': 'offre_acceptee', 'Refusée': 'refuse', 'Abandonnée': 'abandonne',
};
const TYPES: Record<string, PropertyType> = { Appartement: 'appartement', Maison: 'maison', Immeuble: 'immeuble', Parking: 'parking', Local: 'local' };

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }
  return null;
}
export function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

/** Lit les simulations de l'ancienne application présentes dans ce navigateur. */
export function readLegacyLocal(storage: Storage = localStorage): { key: string; simulations: LegacySimulation[] }[] {
  const out: { key: string; simulations: LegacySimulation[] }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !/^idf-invest-v\d+:/.test(key)) continue;
    try {
      const db = JSON.parse(storage.getItem(key) ?? '{}') as { simulations?: unknown };
      const sims = Array.isArray(db.simulations) ? db.simulations.filter((s): s is LegacySimulation => !!s && typeof (s as LegacySimulation).id === 'string') : [];
      if (sims.length) out.push({ key, simulations: sims });
    } catch { /* données illisibles ignorées */ }
  }
  return out;
}

export function legacyRent(d: Record<string, unknown>): number {
  const surface = num(d.surface) ?? 0;
  const low = surface * (num(d.rentM2Low) ?? 0);
  const high = surface * (num(d.rentM2High) ?? 0);
  const level = txt(d.rentLevel);
  const rent = level === 'Bas' ? low : level === 'Haut' ? high : level === 'Moyen' ? (low + high) / 2 : num(d.customRent) ?? 0;
  return Math.round(rent * 100) / 100;
}

export function legacyInputs(d: Record<string, unknown>): Partial<SimulationInputs> & { legacy: unknown } {
  const n = (k: string) => num(d[k]) ?? 0;
  return {
    priceMode: 'hors_honoraires', price: n('offerPrice'), agencyFees: n('agencyFees'),
    notaryMode: 'amount', notaryRate: 7.5, notaryAmount: n('notaryFees'),
    works: n('works'), furniture: n('furniture'), guaranteeFees: n('financeFees'), dossierFees: 0, downPayment: n('downPayment'),
    useLoan: true, interestRate: n('interestRate'), loanYears: Math.max(num(d.loanYears) ?? 20, 1), insuranceRate: n('insuranceRate'),
    deferralMonths: 0, deferralType: 'aucun', monthlyRent: legacyRent(d), chargesProvisionMonthly: n('tenantCharges'),
    coproChargesAnnual: n('coproCharges'), coproRecoverableAnnual: n('recoverableCharges'),
    propertyTaxAnnual: n('propertyTax'), propertyTaxRecoverableAnnual: n('teom'), pnoAnnual: n('pno'),
    managementAnnual: n('managementFees'), gliAnnual: n('gli'), maintenanceAnnual: n('maintenance'),
    vacancyAnnual: n('vacancy'), otherChargesAnnual: n('otherCharges'),
    legacy: {
      number: d.number ?? null, rentM2Low: num(d.rentM2Low), rentM2High: num(d.rentM2High), rentLevel: txt(d.rentLevel),
      customRent: num(d.customRent), simplifiedMode: d.simplifiedMode ?? null,
      results: { totalInvestment: num(d.totalInvestment), cashflowMonthly: num(d.cashflowMonthly), grossYield: num(d.grossYield), netYield: num(d.netYield) },
    },
  };
}

export function legacyProperty(s: LegacySimulation): Insert<Property> {
  const status = STATUS[txt(s.status) ?? ''] ?? 'repere';
  const dpe = txt(s.dpe);
  const url = txt(s.listingUrl);
  const surface = num(s.surface);
  return {
    title: (txt(s.title) ?? s.number ?? 'Bien importé').slice(0, 200),
    status: s.archived ? 'archive' : status,
    status_before_archive: s.archived ? status : null,
    property_type: TYPES[txt(s.propertyType) ?? ''] ?? 'appartement',
    address: txt(s.address), zip: txt(s.zip), city: txt(s.city),
    surface: surface && surface > 0 ? surface : null,
    rooms: num(s.rooms) ? Math.round(num(s.rooms)!) : null,
    dpe: dpe && /^[A-G]$/.test(dpe) ? (dpe as Property['dpe']) : null,
    listing_url: url && /^https?:\/\//i.test(url) ? url : null,
    asking_price: num(s.askingPrice), offer_price: num(s.offerPrice), works_budget: num(s.works),
    estimated_rent: legacyRent(s), comments: txt(s.comments),
    legacy_simulation_id: s.id, legacy_ref: s.number ?? null,
  };
}

/** Contacts agence / agent à créer ou retrouver (dédoublonnage insensible à la casse). */
export function legacyContacts(s: LegacySimulation, existing: Contact[]): { agency: Insert<Contact> | Contact | null; agent: Insert<Contact> | Contact | null } {
  const agencyName = txt(s.agency);
  const agency = agencyName
    ? existing.find((c) => c.kind === 'agence' && c.name.toLowerCase() === agencyName.toLowerCase()) ?? { kind: 'agence' as const, name: agencyName.slice(0, 200), legacy_source: 'idf-invest' }
    : null;
  let email = txt(s.agentEmail)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) email = null;
  const agentName = txt(s.agentName);
  let agent: Insert<Contact> | Contact | null = null;
  if (agentName || email) {
    agent = existing.find((c) => c.kind === 'agent' && (email ? c.email?.toLowerCase() === email : c.name.toLowerCase() === (agentName ?? '').toLowerCase()))
      ?? { kind: 'agent', name: (agentName ?? email ?? '').slice(0, 200), email, phone: txt(s.agentPhone)?.slice(0, 40) ?? null, organization_name: agencyName, legacy_source: 'idf-invest' };
  }
  return { agency, agent };
}
