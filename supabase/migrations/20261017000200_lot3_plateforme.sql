-- =====================================================================
-- Immo-Zen – Lot 3 (2/2) : abonnements, administration, accès support
-- Additive et idempotente. Annulation : supabase/rollback/20261017000200_lot3_plateforme.down.sql
--
-- Sécurité :
--  * Les abonnements ne sont écrits que par le serveur (fonction « platform » et webhook Stripe,
--    clé service_role) ou par un administrateur via des fonctions journalisées.
--  * Le contrôle d'accès par abonnement est DÉSACTIVÉ par défaut (app_config.enforce_subscription).
--    Activé, il bloque les créations, modifications et suppressions des comptes sans accès ;
--    la consultation et l'export restent possibles.
--  * Aucun accès administrateur aux données privées des abonnés, sauf autorisation temporaire
--    donnée par l'abonné (accès support), et chaque consultation est journalisée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuration générale (une seule ligne)
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  id boolean primary key default true check (id),
  enforce_subscription boolean not null default false,
  trial_days int not null default 30 check (trial_days between 0 and 365),
  support_email text check (char_length(support_email) <= 200),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.app_config (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Administrateurs (désignés uniquement en SQL, jamais depuis l'API)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.iz_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Offres et abonnements
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  code text primary key check (code in ('mensuel','annuel')),
  label text not null check (char_length(label) between 1 and 80),
  amount_cents int not null default 0 check (amount_cents >= 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  billing_interval text not null check (billing_interval in ('month','year')),
  stripe_price_id text check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.plans (code, label, billing_interval) values
  ('mensuel', 'Abonnement mensuel', 'month'), ('annuel', 'Abonnement annuel', 'year')
on conflict do nothing;

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null default 'stripe' check (source in ('stripe','manuel')),
  status text not null default 'none' check (status in ('none','trialing','active','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')),
  plan_code text references public.plans(code),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  -- horodatage Stripe de l'état enregistré : un événement plus ancien n'écrase jamais un plus récent
  stripe_updated_at bigint,
  note text check (char_length(note) <= 300),
  updated_at timestamptz not null default now()
);

-- Événements Stripe reçus : la clé primaire rend le traitement idempotent (événements dupliqués)
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'recu' check (status in ('recu','traite','ignore','erreur')),
  user_id uuid,
  error text
);

-- Journal des actions d'administration et des accès support
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid,
  action text not null,
  target_user uuid,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

-- Autorisation d'accès support donnée par l'abonné
create table if not exists public.support_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_until timestamptz not null,
  created_at timestamptz not null default now()
);

-- Prospects commerciaux de la plateforme : séparés des contacts des abonnés, réservés aux administrateurs
create table if not exists public.platform_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 40),
  source text check (char_length(source) <= 120),
  status text not null default 'nouveau' check (status in ('nouveau','contacte','demo','converti','perdu')),
  notes text check (char_length(notes) <= 4000),
  next_follow_up date,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.iz_touch_lead()
returns trigger language plpgsql set search_path = public as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists platform_leads_touch on public.platform_leads;
create trigger platform_leads_touch before update on public.platform_leads for each row execute function public.iz_touch_lead();

-- ---------------------------------------------------------------------
-- Accès
-- ---------------------------------------------------------------------
create or replace function public.iz_access_state(p_user uuid default auth.uid())
returns table (has_access boolean, reason text, until timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  c app_config;
  s subscriptions;
  v_created timestamptz;
begin
  select * into c from app_config limit 1;
  if p_user is null then return query select false, 'anonyme', null::timestamptz; return; end if;
  if exists (select 1 from admins where user_id = p_user) then return query select true, 'administrateur', null::timestamptz; return; end if;
  select * into s from subscriptions where user_id = p_user;
  if s.status in ('active','trialing','past_due') then
    -- past_due : Stripe retente le prélèvement, l'accès est maintenu pendant les relances
    return query select true, 'abonnement_' || s.status, s.current_period_end; return;
  end if;
  if s.status = 'canceled' and s.current_period_end > now() then
    return query select true, 'resilie_fin_de_periode', s.current_period_end; return;
  end if;
  select created_at into v_created from auth.users where id = p_user;
  if v_created + make_interval(days => coalesce(c.trial_days, 0)) > now() then
    return query select true, 'essai', v_created + make_interval(days => c.trial_days); return;
  end if;
  if not coalesce(c.enforce_subscription, false) then
    return query select true, 'acces_libre', null::timestamptz; return;
  end if;
  return query select false, coalesce('abonnement_' || nullif(s.status, 'none'), 'sans_abonnement'), s.current_period_end;
end $$;

create or replace function public.iz_has_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select has_access from public.iz_access_state(auth.uid())), false)
$$;

-- Garde-fou RLS « restrictif » : sans accès, plus de création, modification ni suppression ;
-- la lecture (consultation, export, sauvegarde) reste possible.
do $$
declare t text;
begin
  foreach t in array array['properties','scenarios','timeline_events','property_tasks','pro_contacts','tenants','leases','lease_tenants',
                           'rent_charges','payments','payment_allocations','deposit_movements','reminders','documents','expenses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists iz_gate_insert on public.%I', t);
    execute format('drop policy if exists iz_gate_update on public.%I', t);
    execute format('drop policy if exists iz_gate_delete on public.%I', t);
    execute format('create policy iz_gate_insert on public.%I as restrictive for insert to authenticated with check (public.iz_has_access())', t);
    execute format('create policy iz_gate_update on public.%I as restrictive for update to authenticated using (public.iz_has_access())', t);
    execute format('create policy iz_gate_delete on public.%I as restrictive for delete to authenticated using (public.iz_has_access())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
alter table public.app_config enable row level security;
alter table public.admins enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.admin_audit enable row level security;
alter table public.support_access enable row level security;
alter table public.platform_leads enable row level security;

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated using (true);
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (true);
drop policy if exists plans_admin on public.plans;
create policy plans_admin on public.plans for update to authenticated using (public.iz_is_admin()) with check (public.iz_is_admin());
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated using (user_id = (select auth.uid()) or public.iz_is_admin());
drop policy if exists stripe_events_admin on public.stripe_events;
create policy stripe_events_admin on public.stripe_events for select to authenticated using (public.iz_is_admin());
drop policy if exists admin_audit_admin on public.admin_audit;
create policy admin_audit_admin on public.admin_audit for select to authenticated using (public.iz_is_admin());
drop policy if exists support_access_own on public.support_access;
create policy support_access_own on public.support_access for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and granted_until <= now() + interval '31 days');
drop policy if exists platform_leads_admin on public.platform_leads;
create policy platform_leads_admin on public.platform_leads for all to authenticated using (public.iz_is_admin()) with check (public.iz_is_admin());

revoke all on public.app_config, public.admins, public.plans, public.subscriptions, public.stripe_events, public.admin_audit, public.support_access, public.platform_leads from anon;
revoke insert, update, delete on public.app_config, public.admins, public.subscriptions, public.stripe_events, public.admin_audit from authenticated;
revoke insert, delete on public.plans from authenticated;
grant select on public.app_config, public.admins, public.plans, public.subscriptions, public.stripe_events, public.admin_audit to authenticated;
grant update (label, amount_cents, currency, stripe_price_id, active) on public.plans to authenticated;
grant select, insert, update, delete on public.support_access, public.platform_leads to authenticated;

-- ---------------------------------------------------------------------
-- Fonctions d'administration (vérifient le rôle et journalisent)
-- ---------------------------------------------------------------------
create or replace function public.iz_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
end $$;

-- Liste des comptes : identité, dates, abonnement. Aucune donnée immobilière ni locative.
create or replace function public.iz_admin_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
               status text, source text, plan_code text, current_period_end timestamptz, cancel_at_period_end boolean,
               has_access boolean, access_reason text, support_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform iz_require_admin();
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, exists (select 1 from admins a where a.user_id = u.id),
           coalesce(s.status, 'none'), s.source, s.plan_code, s.current_period_end, coalesce(s.cancel_at_period_end, false),
           st.has_access, st.reason, sa.granted_until
      from auth.users u
      left join subscriptions s on s.user_id = u.id
      left join support_access sa on sa.user_id = u.id and sa.granted_until > now()
      cross join lateral iz_access_state(u.id) st
     order by u.created_at desc;
end $$;

-- Accès offert ou retiré manuellement (geste commercial, partenaire…)
create or replace function public.iz_admin_set_manual_access(p_user uuid, p_until timestamptz, p_note text default null)
returns subscriptions language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  perform iz_require_admin();
  select * into s from subscriptions where user_id = p_user;
  if found and s.source = 'stripe' and s.status in ('active','trialing','past_due') then
    raise exception 'Ce compte a un abonnement Stripe en cours : gérez-le dans Stripe.';
  end if;
  insert into subscriptions (user_id, source, status, current_period_end, note, updated_at)
  values (p_user, 'manuel', case when p_until is null or p_until <= now() then 'canceled' else 'active' end, p_until, left(p_note, 300), now())
  on conflict (user_id) do update set source = 'manuel', status = excluded.status, current_period_end = excluded.current_period_end,
    note = excluded.note, cancel_at_period_end = false, updated_at = now()
  returning * into s;
  insert into admin_audit (admin_id, action, target_user, details) values (auth.uid(), 'acces_manuel', p_user, jsonb_build_object('jusqu_au', p_until, 'note', p_note));
  return s;
end $$;

create or replace function public.iz_admin_set_config(p_enforce boolean, p_trial_days int, p_support_email text)
returns app_config language plpgsql security definer set search_path = public as $$
declare c app_config;
begin
  perform iz_require_admin();
  update app_config set enforce_subscription = p_enforce, trial_days = p_trial_days, support_email = nullif(trim(p_support_email), ''),
    updated_at = now(), updated_by = auth.uid()
  returning * into c;
  insert into admin_audit (admin_id, action, details) values (auth.uid(), 'configuration', to_jsonb(c));
  return c;
end $$;

-- Incidents : e-mails en échec et tâches serveur en erreur (sans contenu des messages)
create or replace function public.iz_admin_incidents()
returns table (kind text, at timestamptz, status text, detail text, user_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  perform iz_require_admin();
  return query
    (select 'email'::text, coalesce(o.sent_at, o.scheduled_at), o.status, left(coalesce(o.last_error, ''), 300) || ' (' || o.kind || ', ' || o.attempts || ' essai(s))', o.user_id
       from email_outbox o where o.status = 'echec' or (o.status = 'a_envoyer' and o.attempts > 0)
      order by 2 desc limit 200)
    union all
    (select 'tache'::text, j.started_at, j.status, j.job || ' : ' || left(j.details::text, 300), null::uuid
       from job_runs j where j.status <> 'ok' order by 2 desc limit 100)
    union all
    (select 'stripe'::text, e.received_at, e.status, e.type || coalesce(' : ' || e.error, ''), e.user_id
       from stripe_events e where e.status = 'erreur' order by 2 desc limit 100);
end $$;

-- Consultation support : uniquement si l'abonné l'a autorisée, résumé chiffré, journalisée
create or replace function public.iz_admin_support_summary(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform iz_require_admin();
  if not exists (select 1 from support_access where user_id = p_user and granted_until > now()) then
    raise exception 'L''abonné n''a pas autorisé l''accès support.';
  end if;
  v := jsonb_build_object(
    'biens', (select count(*) from properties where user_id = p_user),
    'biens_detenus', (select count(*) from properties where user_id = p_user and status = 'acquis'),
    'baux', (select count(*) from leases where user_id = p_user),
    'echeances_impayees', (select count(*) from rent_charges c where c.user_id = p_user and c.cancelled_at is null and c.due_date < current_date
                             and coalesce((select sum(a.amount) from payment_allocations a where a.charge_id = c.id), 0) < c.rent_amount + c.charges_amount),
    'emails_en_echec', (select count(*) from email_outbox where user_id = p_user and status = 'echec'),
    'documents', (select count(*) from documents where user_id = p_user));
  insert into admin_audit (admin_id, action, target_user, details) values (auth.uid(), 'acces_support', p_user, v);
  return v;
end $$;

revoke all on function public.iz_admin_users(), public.iz_admin_set_manual_access(uuid, timestamptz, text), public.iz_admin_set_config(boolean, int, text),
  public.iz_admin_incidents(), public.iz_admin_support_summary(uuid), public.iz_require_admin(), public.iz_access_state(uuid) from public, anon;
grant execute on function public.iz_admin_users(), public.iz_admin_set_manual_access(uuid, timestamptz, text), public.iz_admin_set_config(boolean, int, text),
  public.iz_admin_incidents(), public.iz_admin_support_summary(uuid), public.iz_is_admin(), public.iz_has_access() to authenticated;

-- État d'accès de l'utilisateur connecté (pour l'interface)
create or replace function public.iz_my_access()
returns table (has_access boolean, reason text, until timestamptz, is_admin boolean, enforce boolean)
language sql stable security definer set search_path = public as $$
  select st.has_access, st.reason, st.until, exists (select 1 from admins where user_id = auth.uid()),
         coalesce((select enforce_subscription from app_config limit 1), false)
    from iz_access_state(auth.uid()) st
$$;
revoke all on function public.iz_my_access() from public, anon;
grant execute on function public.iz_my_access() to authenticated;

notify pgrst, 'reload schema';
