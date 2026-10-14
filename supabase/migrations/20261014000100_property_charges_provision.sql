-- Immo-Zen : provision mensuelle sur charges pour les biens détenus.
-- Le loyer charges comprises est calculé (loyer hors charges + provision), il n'est pas stocké.
-- Annulation : supabase/rollback/20261014000100_property_charges_provision.down.sql
alter table public.properties
  add column if not exists charges_provision numeric(12,2)
  check (charges_provision is null or charges_provision >= 0);

comment on column public.properties.charges_provision is 'Provision mensuelle sur charges versée par le locataire (€/mois)';

-- Prise en compte immédiate par l'API
notify pgrst, 'reload schema';
