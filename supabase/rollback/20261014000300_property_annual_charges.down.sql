alter table if exists public.properties
  drop column if exists property_tax_annual, drop column if exists copro_charges_annual, drop column if exists pno_annual,
  drop column if exists management_annual, drop column if exists gli_annual, drop column if exists other_charges_annual;
notify pgrst, 'reload schema';
