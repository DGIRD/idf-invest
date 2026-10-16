-- Immo-Zen : crédit d'un bien détenu (Mes biens), pour le calcul du cash-flow.
-- Le script reprend aussi, sans effet s'ils existent déjà, les champs ajoutés le 14/10/2026
-- (provision sur charges et charges annuelles) : une seule exécution suffit pour être à jour.
-- Il remplace enfin, dans les libellés repris de l'ancienne application, le nom « IDF Invest ».
-- Annulation : supabase/rollback/20261016000100_property_loan.down.sql
alter table public.properties
  add column if not exists charges_provision numeric(12,2) check (charges_provision is null or charges_provision >= 0),
  add column if not exists property_tax_annual numeric(12,2) check (property_tax_annual is null or property_tax_annual >= 0),
  add column if not exists copro_charges_annual numeric(12,2) check (copro_charges_annual is null or copro_charges_annual >= 0),
  add column if not exists pno_annual numeric(12,2) check (pno_annual is null or pno_annual >= 0),
  add column if not exists management_annual numeric(12,2) check (management_annual is null or management_annual >= 0),
  add column if not exists gli_annual numeric(12,2) check (gli_annual is null or gli_annual >= 0),
  add column if not exists other_charges_annual numeric(12,2) check (other_charges_annual is null or other_charges_annual >= 0),
  add column if not exists loan_amount numeric(12,2) check (loan_amount is null or loan_amount >= 0),
  add column if not exists loan_rate numeric(6,3) check (loan_rate is null or (loan_rate >= 0 and loan_rate <= 30)),
  add column if not exists loan_years numeric(4,1) check (loan_years is null or (loan_years > 0 and loan_years <= 40)),
  add column if not exists loan_start_date date,
  add column if not exists loan_insurance_monthly numeric(10,2) check (loan_insurance_monthly is null or loan_insurance_monthly >= 0),
  add column if not exists loan_monthly_payment numeric(10,2) check (loan_monthly_payment is null or loan_monthly_payment >= 0);

-- Libellés des données reprises
update public.scenarios set name = replace(name, 'Simulation IDF Invest', 'Simulation reprise')
 where name like '%IDF Invest%';
update public.timeline_events set summary = replace(summary, 'Repris depuis IDF Invest', 'Repris de l''ancienne version')
 where summary like '%IDF Invest%';
update public.pro_contacts set notes = replace(notes, 'Import IDF Invest', 'Import de l''ancienne version')
 where notes like 'Import IDF Invest%';

notify pgrst, 'reload schema';
