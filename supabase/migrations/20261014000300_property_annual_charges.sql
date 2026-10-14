-- Immo-Zen : charges annuelles d'un bien détenu (Mes biens).
-- Montants annuels en euros ; ils pré-remplissent aussi les nouvelles simulations du bien.
-- Annulation : supabase/rollback/20261014000300_property_annual_charges.down.sql
alter table public.properties
  add column if not exists property_tax_annual numeric(12,2) check (property_tax_annual is null or property_tax_annual >= 0),
  add column if not exists copro_charges_annual numeric(12,2) check (copro_charges_annual is null or copro_charges_annual >= 0),
  add column if not exists pno_annual numeric(12,2) check (pno_annual is null or pno_annual >= 0),
  add column if not exists management_annual numeric(12,2) check (management_annual is null or management_annual >= 0),
  add column if not exists gli_annual numeric(12,2) check (gli_annual is null or gli_annual >= 0),
  add column if not exists other_charges_annual numeric(12,2) check (other_charges_annual is null or other_charges_annual >= 0);

notify pgrst, 'reload schema';
