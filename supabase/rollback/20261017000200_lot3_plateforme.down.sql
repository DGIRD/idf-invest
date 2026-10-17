-- Annule 20261017000200_lot3_plateforme.sql : garde-fous d'accès, abonnements, administration.
-- Les abonnements, événements Stripe, journal et prospects commerciaux sont SUPPRIMÉS.
do $$
declare t text;
begin
  foreach t in array array['properties','scenarios','timeline_events','property_tasks','pro_contacts','tenants','leases','lease_tenants',
                           'rent_charges','payments','payment_allocations','deposit_movements','reminders','documents','expenses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists iz_gate_insert on public.%I', t);
    execute format('drop policy if exists iz_gate_update on public.%I', t);
    execute format('drop policy if exists iz_gate_delete on public.%I', t);
  end loop;
end $$;
drop function if exists public.iz_my_access();
drop function if exists public.iz_admin_support_summary(uuid);
drop function if exists public.iz_admin_incidents();
drop function if exists public.iz_admin_set_config(boolean, int, text);
drop function if exists public.iz_admin_set_manual_access(uuid, timestamptz, text);
drop function if exists public.iz_admin_users();
drop function if exists public.iz_require_admin();
drop function if exists public.iz_has_access();
drop function if exists public.iz_access_state(uuid);
drop table if exists public.platform_leads, public.support_access, public.admin_audit, public.stripe_events, public.subscriptions, public.plans, public.admins, public.app_config;
drop function if exists public.iz_touch_lead();
drop function if exists public.iz_is_admin();
notify pgrst, 'reload schema';
