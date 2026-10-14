import type { AcquisitionSnapshot, Property, Scenario } from '../data/types.ts';
import { normalizeInputs, simulate, summarize, type SimulationInputs, type SimulationResult } from './simulator.ts';
import { todayParis } from './format.ts';

export const isOwned = (p: Pick<Property, 'status'>) => p.status === 'acquis';
export const isProspect = (p: Pick<Property, 'status'>) => p.status !== 'acquis';

export interface PropertyMetrics {
  pricePerM2: number | null;
  scenario: Scenario | null;
  result: SimulationResult | null;
}

/** Prix au m² : prix proposé s'il est renseigné, sinon prix affiché. */
export function pricePerM2(p: Pick<Property, 'surface' | 'offer_price' | 'asking_price'>): number | null {
  const price = p.offer_price ?? p.asking_price;
  if (!p.surface || !price) return null;
  return price / p.surface;
}

export function primaryScenario(p: Property, scenarios: Scenario[]): Scenario | null {
  const own = scenarios.filter((s) => s.property_id === p.id && !s.archived_at);
  return own.find((s) => s.id === p.primary_scenario_id) ?? own[0] ?? null;
}

export function scenarioResult(s: Scenario | null, defaults?: SimulationInputs): SimulationResult | null {
  if (!s) return null;
  const out = simulate(normalizeInputs(s.inputs, defaults));
  return out.ok ? out.result : null;
}

export function metrics(p: Property, scenarios: Scenario[], defaults?: SimulationInputs): PropertyMetrics {
  const scenario = primaryScenario(p, scenarios);
  return { pricePerM2: pricePerM2(p), scenario, result: scenarioResult(scenario, defaults) };
}

/** Loyer charges comprises = loyer hors charges + provision sur charges (mensuel). */
export function rentWithCharges(p: { estimated_rent?: number | null; charges_provision?: number | null }): number | null {
  if (p.estimated_rent == null && p.charges_provision == null) return null;
  return Math.round(((p.estimated_rent ?? 0) + (p.charges_provision ?? 0)) * 100) / 100;
}

/** Pré-remplit un scénario à partir de la fiche du bien. */
export function inputsFromProperty(p: Property, defaults: SimulationInputs): SimulationInputs {
  return {
    ...defaults,
    price: p.offer_price ?? p.asking_price ?? 0,
    works: p.works_budget ?? 0,
    monthlyRent: p.estimated_rent ?? 0,
    chargesProvisionMonthly: p.charges_provision ?? defaults.chargesProvisionMonthly,
  };
}

/**
 * Règles appliquées lors d'un changement de statut.
 * Référence : fonction SQL public.iz_property_status_rules() (source de vérité côté serveur).
 * Cette version sert au mode démonstration local et aux tests.
 */
export function applyStatusRules(prev: Property | null, next: Property, scenarios: Scenario[], now = new Date()): Property {
  const p = { ...next };
  if (p.status === 'archive' && (!prev || prev.status !== 'archive')) {
    p.status_before_archive = p.status_before_archive ?? (prev ? prev.status : 'repere');
  } else if (p.status !== 'archive') {
    p.status_before_archive = null;
  }
  if (p.status === 'acquis' && (!prev || prev.status !== 'acquis')) {
    p.acquired_at = p.acquired_at ?? todayParis(now);
    p.occupation_status = p.occupation_status ?? 'vacant';
    if (!p.acquisition_snapshot && p.primary_scenario_id) {
      const s = scenarios.find((x) => x.id === p.primary_scenario_id && x.user_id === p.user_id);
      if (s) {
        const snap: AcquisitionSnapshot = {
          scenario_id: s.id, scenario_name: s.name, inputs: structuredClone(s.inputs),
          results: s.results, engine_version: s.engine_version, taken_at: now.toISOString(),
        };
        p.acquisition_snapshot = snap;
      }
    }
  }
  if (p.status !== 'acquis') p.occupation_status = null;
  return p;
}

export function statusEventSummary(from: Property['status'] | null, to: Property['status']): { kind: 'creation' | 'status_change' | 'acquisition'; summary: string } {
  if (from === null) {
    return to === 'acquis'
      ? { kind: 'acquisition', summary: 'Bien ajouté directement dans Mes biens' }
      : { kind: 'creation', summary: 'Bien ajouté à la prospection' };
  }
  if (to === 'acquis') return { kind: 'acquisition', summary: 'Bien acquis : transféré dans Mes biens' };
  if (from === 'acquis') return { kind: 'status_change', summary: 'Acquisition annulée : bien revenu en prospection' };
  return { kind: 'status_change', summary: 'Changement de statut' };
}

export { summarize };
