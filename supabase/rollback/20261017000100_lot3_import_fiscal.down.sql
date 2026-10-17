-- Annule 20261017000100_lot3_import_fiscal.sql.
-- Les dépenses des nouvelles catégories sont SUPPRIMÉES (exportez-les avant si besoin).
delete from public.expenses where category in ('credit','assurance_credit','entretien_amortissable','loyer','frais_credit');
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in (
  'copropriete','taxe_fonciere','assurance','interets','frais_bancaires','travaux','mobilier','entretien','gestion','autre'));
drop index if exists public.expenses_import_ref_uq;
alter table public.expenses drop column if exists account, drop column if exists import_ref;
alter table public.user_settings drop column if exists tax_inputs;
notify pgrst, 'reload schema';
