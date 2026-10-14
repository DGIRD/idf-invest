alter table if exists public.properties drop column if exists charges_provision;
notify pgrst, 'reload schema';
