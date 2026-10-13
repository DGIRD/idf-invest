-- =====================================================================
-- Immo-Zen – Lot 1 : schéma principal
-- Migration additive : les tables historiques IDF Invest (public.simulations,
-- public.contacts) ne sont NI modifiées NI supprimées. L'application IDF Invest
-- actuelle continue donc de fonctionner pendant la transition.
-- Annulation : supabase/rollback/20261013000100_immozen_core.down.sql
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------

-- Incrémente la version et met à jour updated_at à chaque modification.
-- Le client envoie la version qu'il a lue (verrou optimiste) : une mise à jour
-- basée sur une version périmée ne touche aucune ligne → conflit détecté,
-- jamais d'écrasement silencieux.
create or replace function public.iz_touch_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.user_id := old.user_id;        -- le propriétaire d'une ligne ne change jamais
  new.created_at := old.created_at;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Profils et paramètres
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.iz_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  simulator_defaults jsonb not null default '{}'::jsonb,
  ui_prefs jsonb not null default '{}'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists iz_on_auth_user_created on auth.users;
create trigger iz_on_auth_user_created
  after insert on auth.users
  for each row execute function public.iz_handle_new_user();

-- Comptes existants (créés avec IDF Invest)
insert into public.profiles (id) select id from auth.users on conflict do nothing;
insert into public.user_settings (user_id) select id from auth.users on conflict do nothing;

-- ---------------------------------------------------------------------
-- Contacts immobiliers (agences, agents, artisans, notaires…)
-- Données privées de l'abonné. Les prospects commerciaux de la plateforme
-- seront dans une table distincte, réservée à l'administration (lot 3).
-- ---------------------------------------------------------------------
create table if not exists public.pro_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'autre'
    check (kind in ('agence','agent','artisan','notaire','banque','courtier','syndic','gestionnaire','diagnostiqueur','autre')),
  name text not null check (char_length(name) between 1 and 200),
  organization_id uuid,
  organization_name text check (char_length(organization_name) <= 200),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  sector text check (char_length(sector) <= 200),
  notes text check (char_length(notes) <= 20000),
  next_follow_up date,
  archived_at timestamptz,
  legacy_source text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- un agent ne peut être rattaché qu'à une agence du même utilisateur
  foreign key (organization_id, user_id) references public.pro_contacts(id, user_id) on delete set null (organization_id)
);
create index if not exists pro_contacts_user_idx on public.pro_contacts(user_id, kind, name);

-- ---------------------------------------------------------------------
-- Biens : une seule table, deux vues métier.
--   Prospection = status <> 'acquis'   |   Mes biens = status = 'acquis'
-- Le passage à « acquis » transfère donc le bien sans duplication.
-- ---------------------------------------------------------------------
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),

  -- statut d'acquisition (pipeline de prospection)
  status text not null default 'repere' check (status in (
    'repere','a_contacter','informations_demandees','visite_a_programmer','visite_programmee',
    'visite','offre_envisagee','offre_transmise','negociation','offre_acceptee','sous_compromis',
    'acquis','refuse','abandonne','archive')),
  status_before_archive text,
  -- statut d'occupation : uniquement pour un bien détenu
  occupation_status text check (occupation_status in ('vacant','loue','travaux','usage_personnel')),

  property_type text not null default 'appartement'
    check (property_type in ('appartement','maison','immeuble','parking','local','terrain','autre')),
  address text check (char_length(address) <= 300),
  zip text check (char_length(zip) <= 12),
  city text check (char_length(city) <= 120),
  surface numeric(10,2) check (surface is null or surface > 0),
  rooms int check (rooms is null or rooms >= 0),
  dpe text check (dpe in ('A','B','C','D','E','F','G')),
  listing_url text check (listing_url is null or listing_url ~* '^https?://'),

  asking_price numeric(14,2) check (asking_price is null or asking_price >= 0),
  offer_price numeric(14,2) check (offer_price is null or offer_price >= 0),
  works_budget numeric(14,2) check (works_budget is null or works_budget >= 0),
  estimated_rent numeric(12,2) check (estimated_rent is null or estimated_rent >= 0),

  agency_id uuid,
  agent_id uuid,

  next_action text check (char_length(next_action) <= 300),
  follow_up_date date,
  visit_at timestamptz,
  comments text check (char_length(comments) <= 50000),
  vigilance jsonb not null default '[]'::jsonb check (jsonb_typeof(vigilance) = 'array'),

  -- détention (biens détenus)
  ownership_mode text check (ownership_mode in ('nom_propre','indivision','sci_ir','sci_is','demembrement','autre')),
  tax_regime text check (tax_regime in ('micro_foncier','reel_foncier','micro_bic','reel_bic','is','autre')),
  acquired_at date,
  acquisition_cost numeric(14,2) check (acquisition_cost is null or acquisition_cost >= 0),
  acquisition_snapshot jsonb,          -- photographie figée des hypothèses à l'acquisition
  primary_scenario_id uuid,

  legacy_simulation_id uuid unique,    -- traçabilité de la migration IDF Invest
  legacy_ref text,

  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (agency_id, user_id) references public.pro_contacts(id, user_id) on delete set null (agency_id),
  foreign key (agent_id, user_id) references public.pro_contacts(id, user_id) on delete set null (agent_id),
  check (status = 'acquis' or occupation_status is null),
  check (status <> 'archive' or status_before_archive is not null)
);
create index if not exists properties_user_status_idx on public.properties(user_id, status, updated_at desc);

-- ---------------------------------------------------------------------
-- Scénarios de simulation (plusieurs par bien, ou autonomes)
-- ---------------------------------------------------------------------
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid,
  name text not null default 'Scénario' check (char_length(name) between 1 and 120),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  results jsonb,                       -- résultats au dernier enregistrement (recalculés par le client)
  engine_version text not null default '1',
  archived_at timestamptz,
  legacy_simulation_id uuid unique,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade
);
create index if not exists scenarios_property_idx on public.scenarios(user_id, property_id);

alter table public.properties drop constraint if exists properties_primary_scenario_fk;
alter table public.properties add constraint properties_primary_scenario_fk
  foreign key (primary_scenario_id, user_id) references public.scenarios(id, user_id) on delete set null (primary_scenario_id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------
-- Historique : échanges, notes, changements de statut
-- ---------------------------------------------------------------------
create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid,
  contact_id uuid,
  kind text not null check (kind in ('creation','status_change','acquisition','exchange','note','visit','migration')),
  channel text check (channel in ('telephone','email','sms','visite','rendez_vous','courrier','autre')),
  occurred_at timestamptz not null default now(),
  summary text not null check (char_length(summary) between 1 and 5000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade,
  foreign key (contact_id, user_id) references public.pro_contacts(id, user_id) on delete set null (contact_id)
);
create index if not exists timeline_property_idx on public.timeline_events(user_id, property_id, occurred_at desc);
create index if not exists timeline_contact_idx on public.timeline_events(user_id, contact_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- Tâches liées à un bien
-- ---------------------------------------------------------------------
create table if not exists public.property_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null,
  title text not null check (char_length(title) between 1 and 300),
  due_date date,
  done_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade
);
create index if not exists tasks_property_idx on public.property_tasks(user_id, property_id);

-- ---------------------------------------------------------------------
-- Déclencheurs
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_settings','pro_contacts','properties','scenarios','property_tasks'] loop
    execute format('drop trigger if exists iz_touch on public.%I', t);
    execute format('create trigger iz_touch before update on public.%I for each row execute function public.iz_touch_row()', t);
  end loop;
end $$;

-- Règles métier sur le statut d'un bien (exécutées côté serveur)
create or replace function public.iz_property_status_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  snap jsonb;
begin
  -- Archivage : mémoriser le statut précédent pour pouvoir désarchiver
  if new.status = 'archive' and (tg_op = 'INSERT' or old.status <> 'archive') then
    new.status_before_archive := coalesce(new.status_before_archive, case when tg_op = 'UPDATE' then old.status end, 'repere');
  elsif new.status <> 'archive' then
    new.status_before_archive := null;
  end if;

  -- Passage à « acquis » : le bien rejoint « Mes biens »
  if new.status = 'acquis' and (tg_op = 'INSERT' or old.status <> 'acquis') then
    new.acquired_at := coalesce(new.acquired_at, current_date);
    new.occupation_status := coalesce(new.occupation_status, 'vacant');
    if new.acquisition_snapshot is null and new.primary_scenario_id is not null then
      select jsonb_build_object(
               'scenario_id', s.id, 'scenario_name', s.name, 'inputs', s.inputs,
               'results', s.results, 'engine_version', s.engine_version, 'taken_at', now())
        into snap
        from public.scenarios s
       where s.id = new.primary_scenario_id and s.user_id = new.user_id;
      new.acquisition_snapshot := snap;
    end if;
  end if;

  -- Un bien qui n'est plus détenu n'a pas de statut d'occupation
  if new.status <> 'acquis' then
    new.occupation_status := null;
  end if;
  return new;
end;
$$;

drop trigger if exists iz_status_rules on public.properties;
create trigger iz_status_rules before insert or update of status on public.properties
  for each row execute function public.iz_property_status_rules();

-- Journalisation automatique des créations et changements de statut
create or replace function public.iz_property_status_log()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.timeline_events (user_id, property_id, kind, summary, data)
    values (new.user_id, new.id, case when new.status = 'acquis' then 'acquisition' else 'creation' end,
            case when new.status = 'acquis' then 'Bien ajouté directement dans Mes biens' else 'Bien ajouté à la prospection' end,
            jsonb_build_object('status', new.status));
  elsif new.status is distinct from old.status then
    insert into public.timeline_events (user_id, property_id, kind, summary, data)
    values (new.user_id, new.id,
            case when new.status = 'acquis' then 'acquisition' else 'status_change' end,
            case when new.status = 'acquis' then 'Bien acquis : transféré dans Mes biens'
                 when old.status = 'acquis' then 'Acquisition annulée : bien revenu en prospection'
                 else 'Changement de statut' end,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;

drop trigger if exists iz_status_log on public.properties;
create trigger iz_status_log after insert or update of status on public.properties
  for each row execute function public.iz_property_status_log();

-- ---------------------------------------------------------------------
-- Sécurité : RLS – chaque utilisateur ne voit et ne modifie que ses lignes
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','user_settings','pro_contacts','properties','scenarios','timeline_events','property_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- profils : lecture / mise à jour de son propre profil uniquement
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, delete on public.profiles from authenticated;

do $$
declare t text;
begin
  foreach t in array array['user_settings','pro_contacts','properties','scenarios','property_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
  end loop;
end $$;

-- historique : lecture, ajout ; suppression limitée aux notes/échanges saisis à la main ; pas de modification
drop policy if exists timeline_select on public.timeline_events;
create policy timeline_select on public.timeline_events for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists timeline_insert on public.timeline_events;
create policy timeline_insert on public.timeline_events for insert to authenticated
  with check (user_id = (select auth.uid()) and kind in ('exchange','note','visit'));
drop policy if exists timeline_delete on public.timeline_events;
create policy timeline_delete on public.timeline_events for delete to authenticated
  using (user_id = (select auth.uid()) and kind in ('exchange','note','visit'));
revoke update on public.timeline_events from authenticated;

-- Les événements système (création, changement de statut, acquisition) ne peuvent pas
-- être insérés par l'utilisateur (politique ci-dessus) : seul le déclencheur les écrit.
-- Il s'exécute donc en SECURITY DEFINER ; il ne fait qu'insérer une ligne d'historique
-- dont le user_id est celui du bien concerné.
alter function public.iz_property_status_log() security definer;
revoke execute on function public.iz_property_status_log() from public, anon, authenticated;
revoke execute on function public.iz_handle_new_user() from public, anon, authenticated;
