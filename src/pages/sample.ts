// Données d'exemple fictives, disponibles uniquement en mode démonstration.
import type { useStore } from '../data/store.tsx';
import { todayParis } from '../domain/format.ts';
import { DEFAULT_INPUTS, ENGINE_VERSION, simulate, summarize, type SimulationInputs } from '../domain/simulator.ts';

type Store = ReturnType<typeof useStore>;

export async function loadSampleData(store: Store) {
  if (store.repo.mode !== 'demo') throw new Error('Données d’exemple réservées au mode démonstration.');
  const day = (n: number) => todayParis(new Date(Date.now() + n * 86400000));
  const agency = await store.create('pro_contacts', { kind: 'agence', name: 'Agence Exemple Centre', email: 'contact@agence-exemple.invalid', phone: '01 00 00 00 00', sector: 'Centre-ville' });
  const agent = await store.create('pro_contacts', { kind: 'agent', name: 'Camille Exemple', organization_id: agency?.id ?? null, email: 'camille@agence-exemple.invalid', next_follow_up: day(-1) });
  await store.create('pro_contacts', { kind: 'notaire', name: 'Étude notariale Exemple', sector: 'Toutes transactions' });
  const props = [
    { title: 'T2 proche gare (exemple)', city: 'Villeneuve-Exemple', zip: '00100', surface: 41, rooms: 2, dpe: 'D' as const, asking_price: 189000, offer_price: 178000, works_budget: 6000, estimated_rent: 820, status: 'visite_programmee' as const, visit_at: new Date(Date.now() + 2 * 86400000).toISOString(), next_action: 'Demander les trois derniers PV d’AG', follow_up_date: day(0) },
    { title: 'Studio étudiant (exemple)', city: 'Exempleville', zip: '00200', surface: 19, rooms: 1, dpe: 'E' as const, asking_price: 98000, offer_price: 92000, estimated_rent: 520, status: 'negociation' as const, next_action: 'Relancer après contre-offre', follow_up_date: day(-2), vigilance: ['DPE E : travaux d’isolation à prévoir avant 2034'] },
    { title: 'Maison avec jardin (exemple)', city: 'Bourg-Exemple', surface: 92, rooms: 4, dpe: 'C' as const, asking_price: 265000, estimated_rent: 1250, status: 'repere' as const, property_type: 'maison' as const },
  ];
  for (const p of props) {
    const row = await store.create('properties', { ...p, agency_id: agency?.id ?? null, agent_id: agent?.id ?? null });
    if (!row) continue;
    const inputs: SimulationInputs = { ...DEFAULT_INPUTS, price: p.offer_price ?? p.asking_price, works: p.works_budget ?? 0, monthlyRent: p.estimated_rent, downPayment: 20000, pnoAnnual: 150, propertyTaxAnnual: 900, coproChargesAnnual: 1200, coproRecoverableAnnual: 700, chargesProvisionMonthly: 60, vacancyAnnual: p.estimated_rent / 2 };
    const out = simulate(inputs);
    const sc = await store.create('scenarios', { property_id: row.id, name: 'Hypothèse de base', inputs, results: out.ok ? summarize(out.result) : null, engine_version: ENGINE_VERSION });
    if (sc) await store.update('properties', row, { primary_scenario_id: sc.id });
  }
  await store.refresh();
}
