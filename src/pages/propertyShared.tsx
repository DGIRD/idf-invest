import { useMemo } from 'react';
import { useStore } from '../data/store.tsx';
import type { Contact, Insert, Property, Scenario } from '../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../domain/exporting.ts';
import { date, money, number, pct } from '../domain/format.ts';
import { OCCUPATION_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { metrics, summarize, type PropertyMetrics } from '../domain/property.ts';
import { normalizeInputs, simulate } from '../domain/simulator.ts';
import type { Column } from '../ui/DataTable.tsx';
import { StatusBadge } from '../ui/components.tsx';

export interface PropertyRow {
  p: Property;
  m: PropertyMetrics;
  agency: Contact | null;
  agent: Contact | null;
}

export function usePropertyRows(filter: (p: Property) => boolean): PropertyRow[] {
  const { data, simulatorDefaults } = useStore();
  return useMemo(() => {
    const contacts = new Map(data.contacts.map((c) => [c.id, c]));
    return data.properties.filter(filter).map((p) => ({
      p,
      m: metrics(p, data.scenarios, simulatorDefaults),
      agency: p.agency_id ? contacts.get(p.agency_id) ?? null : null,
      agent: p.agent_id ? contacts.get(p.agent_id) ?? null : null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.properties, data.scenarios, data.contacts, simulatorDefaults]);
}

const tone = (x: number | null | undefined) => (x === null || x === undefined ? '' : x >= 0 ? 'pos' : 'neg');

export function prospectColumns(): Column<PropertyRow>[] {
  return [
    { id: 'title', label: 'Titre', value: (r) => r.p.title, primary: true },
    { id: 'city', label: 'Ville', value: (r) => r.p.city, mobile: true },
    { id: 'address', label: 'Adresse', value: (r) => r.p.address, defaultHidden: true },
    { id: 'type', label: 'Type', value: (r) => TYPE_LABELS[r.p.property_type], defaultHidden: true },
    { id: 'surface', label: 'Surface', value: (r) => r.p.surface, kind: 'number', align: 'right', render: (r) => (r.p.surface ? `${number(r.p.surface)} m²` : '—'), mobile: true },
    { id: 'rooms', label: 'Pièces', value: (r) => r.p.rooms, kind: 'number', align: 'right', defaultHidden: true },
    { id: 'dpe', label: 'DPE', value: (r) => r.p.dpe, render: (r) => (r.p.dpe ? <span className={`dpe dpe-${r.p.dpe}`}>{r.p.dpe}</span> : '—') },
    { id: 'asking', label: 'Prix affiché', value: (r) => r.p.asking_price, kind: 'money', align: 'right', render: (r) => money(r.p.asking_price), mobile: true },
    { id: 'offer', label: 'Prix proposé', value: (r) => r.p.offer_price, kind: 'money', align: 'right', render: (r) => money(r.p.offer_price) },
    { id: 'm2', label: 'Prix / m²', value: (r) => r.m.pricePerM2, kind: 'money', align: 'right', render: (r) => money(r.m.pricePerM2) },
    { id: 'works', label: 'Travaux', value: (r) => r.p.works_budget, kind: 'money', align: 'right', render: (r) => money(r.p.works_budget), defaultHidden: true },
    { id: 'rent', label: 'Loyer estimé', value: (r) => r.p.estimated_rent, kind: 'money', align: 'right', render: (r) => money(r.p.estimated_rent), defaultHidden: true },
    { id: 'yield', label: 'Rendement brut', value: (r) => r.m.result?.grossYield ?? null, kind: 'percent', align: 'right', render: (r) => pct(r.m.result?.grossYield), mobile: true },
    { id: 'cashflow', label: 'Cash-flow / mois', value: (r) => r.m.result?.cashflowMonthlyYear1 ?? null, kind: 'money', align: 'right',
      render: (r) => <span className={tone(r.m.result?.cashflowMonthlyYear1)}>{money(r.m.result?.cashflowMonthlyYear1)}</span>, mobile: true },
    { id: 'agency', label: 'Agence', value: (r) => r.agency?.name, defaultHidden: true },
    { id: 'agent', label: 'Agent', value: (r) => r.agent?.name, defaultHidden: true },
    { id: 'status', label: 'Statut', value: (r) => STATUS_LABELS[r.p.status], render: (r) => <StatusBadge status={r.p.status} />, mobile: true },
    { id: 'next', label: 'Prochaine action', value: (r) => r.p.next_action },
    { id: 'followup', label: 'Relance', value: (r) => r.p.follow_up_date, kind: 'date', render: (r) => date(r.p.follow_up_date), mobile: true },
    { id: 'visit', label: 'Visite', value: (r) => r.p.visit_at?.slice(0, 10) ?? null, kind: 'date', render: (r) => date(r.p.visit_at), defaultHidden: true },
    { id: 'url', label: 'Annonce', value: (r) => r.p.listing_url, kind: 'url', sortable: false,
      render: (r) => (r.p.listing_url ? <a href={r.p.listing_url} target="_blank" rel="noopener noreferrer">Ouvrir</a> : '—'), defaultHidden: true },
    { id: 'updated', label: 'Modifié le', value: (r) => r.p.updated_at.slice(0, 10), kind: 'date', render: (r) => date(r.p.updated_at), defaultHidden: true },
  ];
}

export interface OwnedRow extends PropertyRow {
  /** Encaissements, dépenses : disponibles au lot 2 (suivi locatif). */
}

export function ownedColumns(): Column<PropertyRow>[] {
  const lot2 = 'Disponible au lot 2 (suivi des loyers et dépenses)';
  return [
    { id: 'title', label: 'Bien', value: (r) => r.p.title, primary: true },
    { id: 'address', label: 'Adresse', value: (r) => [r.p.address, r.p.zip, r.p.city].filter(Boolean).join(' ') || null, mobile: true },
    { id: 'ownership', label: 'Détention', value: (r) => (r.p.ownership_mode ? OWNERSHIP_LABELS[r.p.ownership_mode] : null) },
    { id: 'acquired', label: 'Acquis le', value: (r) => r.p.acquired_at, kind: 'date', render: (r) => date(r.p.acquired_at), mobile: true },
    { id: 'cost', label: 'Coût d’acquisition', value: (r) => r.p.acquisition_cost ?? r.p.acquisition_snapshot?.results?.totalCost ?? null, kind: 'money', align: 'right',
      render: (r) => money(r.p.acquisition_cost ?? r.p.acquisition_snapshot?.results?.totalCost ?? null) },
    { id: 'occupation', label: 'Occupation', value: (r) => (r.p.occupation_status ? OCCUPATION_LABELS[r.p.occupation_status] : null), mobile: true },
    { id: 'tenant', label: 'Locataire actif', value: () => null, sortable: false, render: () => <span className="muted" title={lot2}>lot 2</span> },
    { id: 'rent', label: 'Loyer', value: (r) => r.p.estimated_rent, kind: 'money', align: 'right', render: (r) => money(r.p.estimated_rent), mobile: true },
    { id: 'received', label: 'Encaissements', value: () => null, sortable: false, render: () => <span className="muted" title={lot2}>lot 2</span>, defaultHidden: true },
    { id: 'expenses', label: 'Dépenses', value: () => null, sortable: false, render: () => <span className="muted" title={lot2}>lot 2</span>, defaultHidden: true },
    { id: 'balance', label: 'Solde locatif', value: () => null, sortable: false, render: () => <span className="muted" title={lot2}>lot 2</span>, defaultHidden: true },
    { id: 'cashflow', label: 'Cash-flow prévu / mois', value: (r) => r.m.result?.cashflowMonthlyYear1 ?? null, kind: 'money', align: 'right',
      render: (r) => <span className={tone(r.m.result?.cashflowMonthlyYear1)} title="Cash-flow prévisionnel (simulation). Le cash-flow réel sera calculé au lot 2 à partir des encaissements et dépenses.">{money(r.m.result?.cashflowMonthlyYear1)}</span> },
  ];
}

export function exportColumns(cols: Column<PropertyRow>[]): ExportColumn<PropertyRow>[] {
  return cols.filter((c) => !['tenant', 'received', 'expenses', 'balance'].includes(c.id))
    .map((c) => ({ label: c.label, value: c.value, kind: c.kind === 'percent' ? 'percent' : c.kind }));
}

export async function exportRows(format: 'xlsx' | 'csv' | 'json', name: string, cols: Column<PropertyRow>[], rows: PropertyRow[], scenarios: Scenario[]) {
  const ex = exportColumns(cols);
  const file = `immo-zen-${name}-${stamp()}`;
  if (format === 'csv') downloadBlob(new Blob([toCsv(ex, rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  else if (format === 'xlsx') downloadBlob(await toXlsx([{ name, columns: ex, rows }]), `${file}.xlsx`);
  else {
    const ids = new Set(rows.map((r) => r.p.id));
    const payload = { format: 'immo-zen-export', exported_at: new Date().toISOString(), properties: rows.map((r) => r.p), scenarios: scenarios.filter((s) => s.property_id && ids.has(s.property_id)) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${file}.json`);
  }
}

/** Copie d'un bien (et de ses scénarios) en prospection, sans historique ni tâches. */
export function useDuplicate() {
  const { create, createMany, update, data, notify } = useStore();
  return async (p: Property): Promise<Property | null> => {
    const { id: _id, user_id: _u, version: _v, created_at: _c, updated_at: _up, legacy_simulation_id: _l, legacy_ref: _r, acquisition_snapshot: _s, primary_scenario_id: _ps, ...rest } = p;
    const copy: Insert<Property> = { ...rest, title: `${p.title} (copie)`.slice(0, 200), status: p.status === 'acquis' || p.status === 'archive' ? 'repere' : p.status, status_before_archive: null, occupation_status: null, acquired_at: null };
    const np = await create('properties', copy);
    if (!np) return null;
    const scs = data.scenarios.filter((s) => s.property_id === p.id);
    if (scs.length) {
      const created = await createMany('scenarios', scs.map((s) => ({ property_id: np.id, name: s.name, inputs: s.inputs, results: s.results, engine_version: s.engine_version })));
      const primaryIdx = scs.findIndex((s) => s.id === p.primary_scenario_id);
      const primary = created?.[primaryIdx >= 0 ? primaryIdx : 0];
      if (primary) await update('properties', np, { primary_scenario_id: primary.id });
    }
    notify('Bien dupliqué.');
    return np;
  };
}

/** Recalcule et enregistre le résumé d'un scénario (photographie fidèle au moment de l'acquisition). */
export function scenarioSummary(s: Scenario) {
  const out = simulate(normalizeInputs(s.inputs));
  return out.ok ? summarize(out.result) : null;
}
