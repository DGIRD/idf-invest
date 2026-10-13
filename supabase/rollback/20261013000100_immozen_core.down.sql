-- Annulation du schéma Immo-Zen (lot 1). Exécuter APRÈS l'annulation de la reprise.
-- Supprime toutes les données Immo-Zen. Ne touche pas aux tables IDF Invest
-- (public.simulations, public.contacts) ni à la sauvegarde immozen_backup.
begin;
drop trigger if exists iz_on_auth_user_created on auth.users;
drop table if exists public.property_tasks cascade;
drop table if exists public.timeline_events cascade;
alter table if exists public.properties drop constraint if exists properties_primary_scenario_fk;
drop table if exists public.scenarios cascade;
drop table if exists public.properties cascade;
drop table if exists public.pro_contacts cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.profiles cascade;
drop function if exists public.iz_property_status_log();
drop function if exists public.iz_property_status_rules();
drop function if exists public.iz_handle_new_user();
drop function if exists public.iz_touch_row();
commit;
