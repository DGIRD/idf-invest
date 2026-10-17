-- Immo-Zen – Lot 3 (1/2) : import des dépenses depuis un relevé, nouvelles catégories,
-- recettes importées (catégorie « loyer ») et saisies de la déclaration fiscale.
-- Additive et idempotente. Annulation : supabase/rollback/20261017000100_lot3_import_fiscal.down.sql

-- Catégories : celles d'origine sont conservées (données existantes), les nouvelles s'ajoutent.
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in (
  'copropriete','taxe_fonciere','assurance','interets','frais_bancaires','travaux','mobilier','entretien','gestion','autre',
  'credit','assurance_credit','entretien_amortissable','loyer','frais_credit'));

alter table public.expenses
  add column if not exists account text check (char_length(account) <= 120),
  -- empreinte de la ligne importée (date, libellé, montant, compte) : un même relevé réimporté ne crée pas de doublon
  add column if not exists import_ref text check (char_length(import_ref) <= 128);
create unique index if not exists expenses_import_ref_uq on public.expenses(user_id, import_ref) where import_ref is not null;

-- Saisies complémentaires de la déclaration (régularisation N-1, paramètres d'amortissement…)
alter table public.user_settings add column if not exists tax_inputs jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
