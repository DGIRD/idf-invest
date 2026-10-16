-- Annule 20261016000100_property_loan.sql (colonnes du crédit uniquement ;
-- la provision et les charges annuelles relèvent de leurs propres scripts d'annulation).
alter table if exists public.properties
  drop column if exists loan_amount, drop column if exists loan_rate, drop column if exists loan_years,
  drop column if exists loan_start_date, drop column if exists loan_insurance_monthly, drop column if exists loan_monthly_payment;
notify pgrst, 'reload schema';
