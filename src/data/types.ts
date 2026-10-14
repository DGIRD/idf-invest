// Types des lignes, alignés sur supabase/migrations/20261013000100_immozen_core.sql
import type { SimulationInputs, ScenarioSummary } from '../domain/simulator.ts';

export type PropertyStatus =
  | 'repere' | 'a_contacter' | 'informations_demandees' | 'visite_a_programmer' | 'visite_programmee'
  | 'visite' | 'offre_envisagee' | 'offre_transmise' | 'negociation' | 'offre_acceptee' | 'sous_compromis'
  | 'acquis' | 'refuse' | 'abandonne' | 'archive';
export type OccupationStatus = 'vacant' | 'loue' | 'travaux' | 'usage_personnel';
export type PropertyType = 'appartement' | 'maison' | 'immeuble' | 'parking' | 'local' | 'terrain' | 'autre';
export type OwnershipMode = 'nom_propre' | 'indivision' | 'sci_ir' | 'sci_is' | 'demembrement' | 'autre';
export type TaxRegime = 'micro_foncier' | 'reel_foncier' | 'micro_bic' | 'reel_bic' | 'is' | 'autre';
export type ContactKind = 'agence' | 'agent' | 'artisan' | 'notaire' | 'banque' | 'courtier' | 'syndic' | 'gestionnaire' | 'diagnostiqueur' | 'autre';
export type EventKind = 'creation' | 'status_change' | 'acquisition' | 'exchange' | 'note' | 'visit' | 'migration';
export type Channel = 'telephone' | 'email' | 'sms' | 'visite' | 'rendez_vous' | 'courrier' | 'autre';

interface Versioned {
  id: string;
  user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Property extends Versioned {
  title: string;
  status: PropertyStatus;
  status_before_archive: PropertyStatus | null;
  occupation_status: OccupationStatus | null;
  property_type: PropertyType;
  address: string | null;
  zip: string | null;
  city: string | null;
  surface: number | null;
  rooms: number | null;
  dpe: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null;
  listing_url: string | null;
  asking_price: number | null;
  offer_price: number | null;
  works_budget: number | null;
  estimated_rent: number | null;
  /** Provision mensuelle sur charges (biens détenus). */
  charges_provision?: number | null;
  agency_id: string | null;
  agent_id: string | null;
  next_action: string | null;
  follow_up_date: string | null;
  visit_at: string | null;
  comments: string | null;
  vigilance: string[];
  ownership_mode: OwnershipMode | null;
  tax_regime: TaxRegime | null;
  acquired_at: string | null;
  acquisition_cost: number | null;
  acquisition_snapshot: AcquisitionSnapshot | null;
  primary_scenario_id: string | null;
  legacy_simulation_id: string | null;
  legacy_ref: string | null;
}

export interface AcquisitionSnapshot {
  scenario_id: string;
  scenario_name: string;
  inputs: Partial<SimulationInputs>;
  results: ScenarioSummary | null;
  engine_version: string;
  taken_at: string;
}

export interface Scenario extends Versioned {
  property_id: string | null;
  name: string;
  inputs: Partial<SimulationInputs> & { legacy?: unknown };
  results: ScenarioSummary | null;
  engine_version: string;
  archived_at: string | null;
  legacy_simulation_id: string | null;
}

export interface Contact extends Versioned {
  kind: ContactKind;
  name: string;
  organization_id: string | null;
  organization_name: string | null;
  email: string | null;
  phone: string | null;
  sector: string | null;
  notes: string | null;
  next_follow_up: string | null;
  archived_at: string | null;
  legacy_source: string | null;
}

export interface PropertyTask extends Versioned {
  property_id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
}

export interface TimelineEvent {
  id: string;
  user_id: string;
  property_id: string | null;
  contact_id: string | null;
  kind: EventKind;
  channel: Channel | null;
  occurred_at: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  simulator_defaults: Partial<SimulationInputs>;
  ui_prefs: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export interface Tables {
  properties: Property;
  scenarios: Scenario;
  pro_contacts: Contact;
  property_tasks: PropertyTask;
  timeline_events: TimelineEvent;
}
export type TableName = keyof Tables;
export type VersionedTable = 'properties' | 'scenarios' | 'pro_contacts' | 'property_tasks';

/** Colonnes gérées par le serveur, jamais envoyées par le client. */
export type ServerManaged = 'id' | 'user_id' | 'version' | 'created_at' | 'updated_at';
export type Insert<T> = Partial<Omit<T, ServerManaged>> & { id?: string };
export type Patch<T> = Partial<Omit<T, ServerManaged>>;
