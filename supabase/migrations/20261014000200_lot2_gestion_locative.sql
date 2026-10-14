-- =====================================================================
-- Immo-Zen – Lot 2 : gestion locative
-- Locataires, baux (colocation, baux successifs), échéances, paiements et
-- affectations, dépôt de garantie, quittances et reçus, relances, dépenses,
-- documents privés, file d'e-mails et journal des tâches serveur.
--
-- Principes :
--  * le solde n'est jamais saisi : il découle des échéances et des paiements ;
--  * une quittance ne peut être émise que pour une échéance intégralement réglée,
--    une seule fois ; elle est créée par le serveur, jamais par le navigateur ;
--  * aucun e-mail ne part du navigateur : il est placé dans une file traitée par
--    le serveur (Edge Function), avec clé anti-doublon ;
--  * l'absence de réponse du propriétaire ne vaut jamais paiement.
-- Annulation : supabase/rollback/20261014000200_lot2_gestion_locative.down.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Paramètres de gestion locative (identité du bailleur, modèles de relance)
-- ---------------------------------------------------------------------
alter table public.user_settings add column if not exists rental_settings jsonb not null default '{}'::jsonb;

-- Montant au format français (1234,56)
create or replace function public.iz_eur(v numeric)
returns text language sql immutable as $$ select replace(to_char(coalesce(v, 0), 'FM999999990.00'), '.', ',') $$;

-- Date du jour à Paris
create or replace function public.iz_today_paris()
returns date language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- ---------------------------------------------------------------------
-- Locataires
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text check (char_length(first_name) <= 120),
  last_name text not null check (char_length(last_name) between 1 and 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 20000),
  archived_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------------------------------------------------------------------
-- Baux (plusieurs baux successifs par bien ; colocation = plusieurs titulaires
-- sur un bail, ou plusieurs baux individuels simultanés)
-- ---------------------------------------------------------------------
create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null,
  label text check (char_length(label) <= 120),            -- ex. « Chambre 2 » en colocation
  furnished boolean not null default false,
  start_date date not null,
  end_date date,
  rent_hc numeric(12,2) not null check (rent_hc >= 0),
  charges_amount numeric(12,2) not null default 0 check (charges_amount >= 0),
  charges_mode text not null default 'provision' check (charges_mode in ('provision','forfait')),
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  payment_day int not null default 1 check (payment_day between 1 and 28),
  landlord_name text check (char_length(landlord_name) <= 200),
  landlord_address text check (char_length(landlord_address) <= 500),
  owner_confirmation_email boolean not null default false,  -- e-mail mensuel au propriétaire
  receipt_auto_send boolean not null default false,         -- envoi automatique des quittances
  reminder_enabled boolean not null default false,          -- préparation automatique des relances
  reminder_delay_days int not null default 10 check (reminder_delay_days between 1 and 90),
  notes text check (char_length(notes) <= 20000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade,
  check (end_date is null or end_date >= start_date)
);
create index if not exists leases_property_idx on public.leases(user_id, property_id, start_date desc);

create table if not exists public.lease_tenants (
  lease_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  left_on date,                                             -- départ d'un colocataire
  created_at timestamptz not null default now(),
  primary key (lease_id, tenant_id),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenants(id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Échéances (loyer du mois, régularisation, autre)
-- ---------------------------------------------------------------------
create table if not exists public.rent_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lease_id uuid not null,
  kind text not null default 'loyer' check (kind in ('loyer','regularisation','autre')),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  rent_amount numeric(12,2) not null default 0 check (rent_amount >= 0),
  charges_amount numeric(12,2) not null default 0,          -- négatif possible pour une régularisation en faveur du locataire
  label text check (char_length(label) <= 200),
  cancelled_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade,
  check (period_end >= period_start),
  check (kind <> 'loyer' or charges_amount >= 0),
  check (rent_amount + charges_amount >= 0)
);
create unique index if not exists rent_charges_one_rent_per_month on public.rent_charges(lease_id, period_start) where kind = 'loyer';
create index if not exists rent_charges_due_idx on public.rent_charges(user_id, due_date);

-- ---------------------------------------------------------------------
-- Paiements et affectations aux échéances
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lease_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  date_defaulted boolean not null default false,            -- date du jour proposée par défaut, non confirmée
  method text not null default 'virement' check (method in ('virement','prelevement','cheque','especes','caf','autre')),
  reference text check (char_length(reference) <= 200),
  comment text check (char_length(comment) <= 2000),
  source text not null default 'saisie' check (source in ('saisie','confirmation','import')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade
);
create index if not exists payments_lease_idx on public.payments(user_id, lease_id, paid_on);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payment_id uuid not null,
  charge_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, charge_id),
  foreign key (payment_id, user_id) references public.payments(id, user_id) on delete cascade,
  foreign key (charge_id, user_id) references public.rent_charges(id, user_id) on delete cascade
);
create index if not exists allocations_charge_idx on public.payment_allocations(charge_id);

-- ---------------------------------------------------------------------
-- Dépôt de garantie : mouvements séparés des loyers
-- ---------------------------------------------------------------------
create table if not exists public.deposit_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lease_id uuid not null,
  kind text not null check (kind in ('encaissement','restitution','retenue')),
  amount numeric(12,2) not null check (amount > 0),
  occurred_on date not null,
  comment text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Quittances et reçus (créés uniquement par le serveur)
-- ---------------------------------------------------------------------
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lease_id uuid not null,
  charge_id uuid not null,
  kind text not null check (kind in ('quittance','recu')),
  number text not null,
  issued_on date not null,
  period_start date not null,
  period_end date not null,
  rent_amount numeric(12,2) not null,
  charges_amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null,
  payments jsonb not null default '[]'::jsonb,              -- [{date, amount, method}]
  tenant_names text not null,
  tenant_emails text[] not null default '{}',
  landlord_name text,
  landlord_address text,
  property_address text,
  send_status text not null default 'non_envoye' check (send_status in ('non_envoye','a_envoyer','envoye','echec')),
  sent_at timestamptz,
  send_error text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, number),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade,
  foreign key (charge_id, user_id) references public.rent_charges(id, user_id) on delete cascade
);
create unique index if not exists receipts_one_quittance_per_charge on public.receipts(charge_id) where kind = 'quittance' and cancelled_at is null;

-- ---------------------------------------------------------------------
-- Relances amiables
-- ---------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lease_id uuid not null,
  level int not null default 1 check (level between 1 and 3),
  charge_ids uuid[] not null default '{}',
  debt_amount numeric(12,2) not null default 0,
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 20000),
  recipients text[] not null default '{}',
  status text not null default 'brouillon' check (status in ('brouillon','a_envoyer','envoye','echec','annule','envoye_manuellement')),
  created_by text not null default 'proprietaire' check (created_by in ('proprietaire','automatique')),
  sent_at timestamptz,
  error text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade
);
create index if not exists reminders_lease_idx on public.reminders(user_id, lease_id, created_at desc);

-- ---------------------------------------------------------------------
-- Documents privés (fichiers dans le bucket Storage « documents »)
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid,
  lease_id uuid,
  tenant_id uuid,
  category text not null default 'autre' check (category in ('bail','quittance','facture','diagnostic','assurance','fiscal','copropriete','photo','identite','autre')),
  title text not null check (char_length(title) between 1 and 200),
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'application/pdf','image/jpeg','image/png','image/webp','image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  notes text check (char_length(notes) <= 2000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade,
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete set null (lease_id),
  foreign key (tenant_id, user_id) references public.tenants(id, user_id) on delete set null (tenant_id),
  check (split_part(storage_path, '/', 1) = user_id::text)
);
create index if not exists documents_user_idx on public.documents(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Dépenses
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null,
  expense_date date not null,
  supplier text check (char_length(supplier) <= 200),
  label text check (char_length(label) <= 300),
  amount numeric(12,2) not null check (amount > 0),
  category text not null check (category in ('copropriete','taxe_fonciere','assurance','interets','frais_bancaires','travaux','mobilier','entretien','gestion','autre')),
  -- trésorerie seule / charge déductible / immobilisation (travaux d'amélioration, mobilier) / remboursement de capital
  nature text not null default 'charge' check (nature in ('charge','immobilisation','remboursement_capital','tresorerie')),
  recoverable_amount numeric(12,2) not null default 0 check (recoverable_amount >= 0),
  payment_status text not null default 'paye' check (payment_status in ('a_payer','paye')),
  paid_on date,
  document_id uuid,
  notes text check (char_length(notes) <= 2000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, user_id) references public.properties(id, user_id) on delete cascade,
  foreign key (document_id, user_id) references public.documents(id, user_id) on delete set null (document_id),
  check (recoverable_amount <= amount),
  check (payment_status = 'a_payer' or paid_on is not null)
);
create index if not exists expenses_property_idx on public.expenses(user_id, property_id, expense_date desc);

-- ---------------------------------------------------------------------
-- File d'e-mails, journal des tâches, suppressions de fichiers (serveur)
-- ---------------------------------------------------------------------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider')),
  to_emails text[] not null check (cardinality(to_emails) between 1 and 10),
  subject text not null,
  body_text text not null,
  receipt_id uuid,
  reminder_id uuid,
  lease_id uuid,
  charge_id uuid,
  dedupe_key text not null unique,
  status text not null default 'a_envoyer' check (status in ('a_envoyer','en_cours','envoye','echec','annule')),
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outbox_pending_idx on public.email_outbox(status, scheduled_at);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  run_key text not null,
  status text not null default 'en_cours' check (status in ('en_cours','ok','erreur')),
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job, run_key)
);

create table if not exists public.storage_deletions (
  storage_path text primary key,
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text
);

-- ---------------------------------------------------------------------
-- Déclencheurs de version
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenants','leases','rent_charges','payments','reminders','documents','expenses'] loop
    execute format('drop trigger if exists iz_touch on public.%I', t);
    execute format('create trigger iz_touch before update on public.%I for each row execute function public.iz_touch_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Règles serveur
-- ---------------------------------------------------------------------

-- Un bail ne concerne qu'un bien détenu ; son bien ne change pas.
create or replace function public.iz_lease_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.property_id <> old.property_id then
    if not exists (select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id and p.status = 'acquis') then
      raise exception 'Un bail ne peut concerner qu''un bien détenu (rubrique Mes biens).' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.property_id <> old.property_id
     and exists (select 1 from rent_charges c where c.lease_id = old.id) then
    raise exception 'Le bien d''un bail ayant des échéances ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  -- Fin de bail avancée : les échéances futures sans paiement sont annulées
  if tg_op = 'UPDATE' and new.end_date is not null and (old.end_date is null or new.end_date < old.end_date) then
    update rent_charges c set cancelled_at = now()
     where c.lease_id = new.id and c.kind = 'loyer' and c.period_start > new.end_date and c.cancelled_at is null
       and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  end if;
  return new;
end $$;
drop trigger if exists iz_lease_rules on public.leases;
create trigger iz_lease_rules before insert or update on public.leases for each row execute function public.iz_lease_rules();

-- Montant affecté à une échéance
create or replace function public.iz_charge_allocated(p_charge uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(amount), 0) from payment_allocations where charge_id = p_charge
$$;

-- Affectations : cohérence bail, plafond paiement, plafond échéance (verrous contre les écritures concurrentes)
create or replace function public.iz_allocation_rules()
returns trigger language plpgsql set search_path = public as $$
declare p payments%rowtype; c rent_charges%rowtype; s numeric;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and exists (select 1 from receipts r where r.charge_id = old.charge_id and r.kind = 'quittance' and r.cancelled_at is null) then
      raise exception 'Une quittance a été émise pour cette échéance : annulez-la avant de modifier ses paiements.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  select * into p from payments where id = new.payment_id for update;
  select * into c from rent_charges where id = new.charge_id for update;
  if p.lease_id <> c.lease_id then
    raise exception 'Le paiement et l''échéance concernent des baux différents.' using errcode = 'check_violation';
  end if;
  if c.cancelled_at is not null then
    raise exception 'Cette échéance est annulée.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 and new.amount < old.amount
     and exists (select 1 from receipts r where r.charge_id = new.charge_id and r.kind = 'quittance' and r.cancelled_at is null) then
    raise exception 'Une quittance a été émise pour cette échéance : annulez-la avant de modifier ses paiements.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount), 0) into s from payment_allocations where payment_id = new.payment_id and id <> new.id;
  if s + new.amount > p.amount then
    raise exception 'La répartition (% €) dépasse le montant du paiement (% €).', iz_eur(s + new.amount), iz_eur(p.amount) using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount), 0) into s from payment_allocations where charge_id = new.charge_id and id <> new.id;
  if s + new.amount > c.rent_amount + c.charges_amount then
    raise exception 'La répartition dépasse le montant dû de l''échéance (% €).', iz_eur(c.rent_amount + c.charges_amount) using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists iz_allocation_rules on public.payment_allocations;
create trigger iz_allocation_rules before insert or update or delete on public.payment_allocations for each row execute function public.iz_allocation_rules();

-- Paiement : le montant ne peut pas descendre sous ce qui est déjà réparti ; bail immuable ;
-- suppression interdite si une quittance couvre une échéance qu'il règle.
create or replace function public.iz_payment_rules()
returns trigger language plpgsql set search_path = public as $$
declare s numeric;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and exists (
      select 1 from payment_allocations a join receipts r on r.charge_id = a.charge_id and r.kind = 'quittance' and r.cancelled_at is null
       where a.payment_id = old.id) then
      raise exception 'Ce paiement est couvert par une quittance : annulez-la avant de supprimer le paiement.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.lease_id <> old.lease_id then
    raise exception 'Le bail d''un paiement ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount), 0) into s from payment_allocations where payment_id = new.id;
  if new.amount < s then
    raise exception 'Le montant (% €) est inférieur à ce qui est déjà réparti sur les échéances (% €).', iz_eur(new.amount), iz_eur(s) using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists iz_payment_rules on public.payments;
create trigger iz_payment_rules before update or delete on public.payments for each row execute function public.iz_payment_rules();

-- Échéance : montant ≥ déjà réglé, bail immuable, pas d'annulation d'une échéance réglée
create or replace function public.iz_charge_rules()
returns trigger language plpgsql set search_path = public as $$
declare s numeric;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and exists (select 1 from payment_allocations a where a.charge_id = old.id) then
      raise exception 'Cette échéance a reçu des paiements : retirez-les ou annulez l''échéance.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.lease_id <> old.lease_id then
    raise exception 'Le bail d''une échéance ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  s := iz_charge_allocated(new.id);
  if new.rent_amount + new.charges_amount < s then
    raise exception 'Le montant dû ne peut pas être inférieur à ce qui est déjà réglé (% €).', iz_eur(s) using errcode = 'check_violation';
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null and s > 0 then
    raise exception 'Une échéance ayant reçu des paiements ne peut pas être annulée.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists iz_charge_rules on public.rent_charges;
create trigger iz_charge_rules before update or delete on public.rent_charges for each row execute function public.iz_charge_rules();

-- Relances : seul un brouillon est modifiable ; l'utilisateur ne peut que l'annuler
-- ou le marquer « envoyé manuellement ». L'envoi par e-mail passe par iz_queue_reminder().
create or replace function public.iz_reminder_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') or pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'brouillon' or new.created_by <> 'proprietaire' then
      raise exception 'Une relance est créée en brouillon.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status <> 'brouillon' then
    raise exception 'Seule une relance en brouillon peut être modifiée.' using errcode = 'check_violation';
  end if;
  if new.status not in ('brouillon','annule','envoye_manuellement') then
    raise exception 'Statut de relance non autorisé.' using errcode = 'check_violation';
  end if;
  if new.status = 'envoye_manuellement' then new.sent_at := now(); end if;
  return new;
end $$;
drop trigger if exists iz_reminder_rules on public.reminders;
create trigger iz_reminder_rules before insert or update on public.reminders for each row execute function public.iz_reminder_rules();

-- Suppression d'un document : fichier mis en file pour suppression par le serveur
create or replace function public.iz_document_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into storage_deletions (storage_path) values (old.storage_path) on conflict do nothing;
  return old;
end $$;
drop trigger if exists iz_document_deleted on public.documents;
create trigger iz_document_deleted after delete on public.documents for each row execute function public.iz_document_deleted();

-- ---------------------------------------------------------------------
-- Génération des échéances mensuelles à partir du bail
-- Prorata au nombre de jours calendaires du mois pour un mois incomplet.
-- Idempotente : un seul loyer par bail et par mois (index unique).
-- ---------------------------------------------------------------------
create or replace function public.iz_generate_rent_charges(p_lease uuid, p_until date default null)
returns int language plpgsql security invoker set search_path = public as $$
declare
  l leases%rowtype; m date; me date; ps date; pe date; dim int; ratio numeric; v_until date; v_due date; n int := 0; k int;
begin
  select * into l from leases where id = p_lease;
  if not found then raise exception 'Bail introuvable.'; end if;
  v_until := coalesce(p_until, iz_today_paris());
  if l.end_date is not null then v_until := least(v_until, l.end_date); end if;
  m := date_trunc('month', l.start_date)::date;
  while m <= v_until loop
    me := (m + interval '1 month' - interval '1 day')::date;
    ps := greatest(m, l.start_date);
    pe := least(me, coalesce(l.end_date, me));
    dim := extract(day from me)::int;
    ratio := (pe - ps + 1)::numeric / dim;
    v_due := least(greatest(m + (l.payment_day - 1), ps), pe);
    insert into rent_charges (user_id, lease_id, kind, period_start, period_end, due_date, rent_amount, charges_amount)
    values (l.user_id, l.id, 'loyer', ps, pe, v_due, round(l.rent_hc * ratio, 2), round(l.charges_amount * ratio, 2))
    on conflict do nothing;
    get diagnostics k = row_count;
    n := n + k;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Quittances et reçus
-- ---------------------------------------------------------------------
create or replace function public.iz__issue_receipt(p_charge uuid, p_kind text)
returns public.receipts language plpgsql security definer set search_path = public as $$
declare
  c rent_charges%rowtype; l leases%rowtype; p properties%rowtype; r receipts%rowtype;
  v_total numeric; v_paid numeric; v_year int; v_seq int; v_names text; v_emails text[]; v_payments jsonb;
begin
  select * into c from rent_charges where id = p_charge for update;
  if not found then raise exception 'Échéance introuvable.'; end if;
  if c.cancelled_at is not null then raise exception 'Échéance annulée.' using errcode = 'check_violation'; end if;
  v_total := c.rent_amount + c.charges_amount;
  v_paid := iz_charge_allocated(c.id);
  if p_kind = 'quittance' then
    select * into r from receipts where charge_id = c.id and kind = 'quittance' and cancelled_at is null;
    if found then return r; end if;                         -- jamais de doublon
    if v_total <= 0 or v_paid < v_total then
      raise exception 'Quittance impossible : la période n''est pas intégralement réglée (% € sur % €).', iz_eur(v_paid), iz_eur(v_total) using errcode = 'check_violation';
    end if;
  elsif p_kind = 'recu' then
    if v_paid <= 0 then raise exception 'Aucun paiement enregistré sur cette échéance.' using errcode = 'check_violation'; end if;
    if v_paid >= v_total then raise exception 'Échéance intégralement réglée : émettez une quittance.' using errcode = 'check_violation'; end if;
  else
    raise exception 'Type de document inconnu.';
  end if;
  select * into l from leases where id = c.lease_id;
  select * into p from properties where id = l.property_id;
  select string_agg(trim(coalesce(t.first_name || ' ', '') || t.last_name), ', ' order by t.last_name),
         coalesce(array_agg(t.email) filter (where t.email is not null), '{}')
    into v_names, v_emails
    from lease_tenants lt join tenants t on t.id = lt.tenant_id
   where lt.lease_id = l.id and (lt.left_on is null or lt.left_on >= c.period_start);
  select coalesce(jsonb_agg(jsonb_build_object('date', py.paid_on, 'amount', a.amount, 'method', py.method) order by py.paid_on), '[]'::jsonb)
    into v_payments
    from payment_allocations a join payments py on py.id = a.payment_id where a.charge_id = c.id;
  v_year := extract(year from iz_today_paris())::int;
  perform pg_advisory_xact_lock(hashtext(c.user_id::text || p_kind || v_year));
  select count(*) + 1 into v_seq from receipts where user_id = c.user_id and kind = p_kind and extract(year from issued_on) = v_year;
  insert into receipts (user_id, lease_id, charge_id, kind, number, issued_on, period_start, period_end, rent_amount, charges_amount,
                        paid_amount, payments, tenant_names, tenant_emails, landlord_name, landlord_address, property_address)
  values (c.user_id, c.lease_id, c.id, p_kind,
          (case p_kind when 'quittance' then 'Q-' else 'R-' end) || v_year || '-' || lpad(v_seq::text, 4, '0'),
          iz_today_paris(), c.period_start, c.period_end, c.rent_amount, c.charges_amount, least(v_paid, v_total), v_payments,
          coalesce(v_names, '—'), v_emails, l.landlord_name, l.landlord_address,
          nullif(concat_ws(' ', p.address, p.zip, p.city), ''))
  returning * into r;
  return r;
end $$;
revoke all on function public.iz__issue_receipt(uuid, text) from public, anon, authenticated;

create or replace function public.iz_issue_receipt(p_charge uuid, p_kind text default 'quittance')
returns public.receipts language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rent_charges where id = p_charge and user_id = auth.uid()) then
    raise exception 'Échéance introuvable.' using errcode = 'insufficient_privilege';
  end if;
  return iz__issue_receipt(p_charge, p_kind);
end $$;

create or replace function public.iz_cancel_receipt(p_receipt uuid, p_reason text)
returns public.receipts language plpgsql security definer set search_path = public as $$
declare r receipts%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indiquez le motif d''annulation.' using errcode = 'check_violation'; end if;
  update receipts set cancelled_at = now(), cancel_reason = left(p_reason, 500)
   where id = p_receipt and user_id = auth.uid() and cancelled_at is null returning * into r;
  if not found then raise exception 'Quittance introuvable ou déjà annulée.'; end if;
  update email_outbox set status = 'annule' where receipt_id = p_receipt and status = 'a_envoyer';
  return r;
end $$;

-- Mise en file de l'envoi d'une quittance au(x) locataire(s) : une seule fois par document
create or replace function public.iz__queue_receipt_email(p_receipt uuid)
returns public.email_outbox language plpgsql security definer set search_path = public as $$
declare r receipts%rowtype; o email_outbox%rowtype; v_label text;
begin
  select * into r from receipts where id = p_receipt;
  if not found or r.cancelled_at is not null then raise exception 'Document introuvable ou annulé.'; end if;
  if cardinality(r.tenant_emails) = 0 then
    raise exception 'Aucune adresse e-mail de locataire : renseignez-la dans la fiche locataire.' using errcode = 'check_violation';
  end if;
  v_label := case r.kind when 'quittance' then 'Quittance de loyer' else 'Reçu de paiement partiel' end;
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, receipt_id, lease_id, charge_id, dedupe_key)
  values (r.user_id, 'quittance', r.tenant_emails,
          v_label || ' – ' || to_char(r.period_start, 'MM/YYYY'),
          'Bonjour,' || chr(10) || chr(10) || 'Veuillez trouver ci-joint votre ' || lower(v_label) || ' n° ' || r.number
            || ' pour la période du ' || to_char(r.period_start, 'DD/MM/YYYY') || ' au ' || to_char(r.period_end, 'DD/MM/YYYY') || '.'
            || chr(10) || chr(10) || 'Cordialement,' || chr(10) || coalesce(r.landlord_name, ''),
          r.id, r.lease_id, r.charge_id, 'recu:' || r.id)
  on conflict (dedupe_key) do nothing
  returning * into o;
  if o.id is null then select * into o from email_outbox where dedupe_key = 'recu:' || r.id; end if;
  update receipts set send_status = case when o.status = 'envoye' then 'envoye' else 'a_envoyer' end where id = r.id;
  return o;
end $$;
revoke all on function public.iz__queue_receipt_email(uuid) from public, anon, authenticated;

create or replace function public.iz_queue_receipt_email(p_receipt uuid)
returns public.email_outbox language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from receipts where id = p_receipt and user_id = auth.uid()) then
    raise exception 'Document introuvable.' using errcode = 'insufficient_privilege';
  end if;
  return iz__queue_receipt_email(p_receipt);
end $$;

-- Envoi automatique d'une quittance : uniquement si le propriétaire l'a activé, après un paiement
-- qu'il a lui-même enregistré ou confirmé, si le montant réglé est exactement le montant dû,
-- et si aucune quittance n'existe déjà pour la période.
create or replace function public.iz_auto_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare c rent_charges%rowtype; l leases%rowtype; r receipts%rowtype;
begin
  select * into c from rent_charges where id = new.charge_id;
  select * into l from leases where id = c.lease_id;
  if not l.receipt_auto_send or c.cancelled_at is not null then return null; end if;
  if iz_charge_allocated(c.id) <> c.rent_amount + c.charges_amount then return null; end if;
  if exists (select 1 from receipts where charge_id = c.id and kind = 'quittance' and cancelled_at is null) then return null; end if;
  r := iz__issue_receipt(c.id, 'quittance');
  if cardinality(r.tenant_emails) > 0 then perform iz__queue_receipt_email(r.id); end if;
  return null;
end $$;
drop trigger if exists iz_auto_receipt on public.payment_allocations;
create trigger iz_auto_receipt after insert or update on public.payment_allocations for each row execute function public.iz_auto_receipt();

-- Reste dû sur une liste d'échéances
create or replace function public.iz_charges_remaining(p_charges uuid[])
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(greatest(c.rent_amount + c.charges_amount - iz_charge_allocated(c.id), 0)), 0)
    from rent_charges c where c.id = any(p_charges) and c.cancelled_at is null
$$;

-- Envoi d'une relance validée par le propriétaire (après aperçu)
create or replace function public.iz_queue_reminder(p_reminder uuid)
returns public.reminders language plpgsql security definer set search_path = public as $$
declare m reminders%rowtype; v_due numeric;
begin
  select * into m from reminders where id = p_reminder and user_id = auth.uid() for update;
  if not found then raise exception 'Relance introuvable.' using errcode = 'insufficient_privilege'; end if;
  if m.status <> 'brouillon' then raise exception 'Cette relance n''est plus un brouillon.' using errcode = 'check_violation'; end if;
  if cardinality(m.recipients) = 0 then raise exception 'Aucun destinataire : renseignez l''e-mail du locataire.' using errcode = 'check_violation'; end if;
  v_due := iz_charges_remaining(m.charge_ids);
  if v_due <= 0 then
    update reminders set status = 'annule', error = 'Dette réglée avant l''envoi' where id = m.id returning * into m;
    return m;
  end if;
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, reminder_id, lease_id, dedupe_key)
  values (m.user_id, 'relance', m.recipients, m.subject, m.body, m.id, m.lease_id, 'relance:' || m.id)
  on conflict (dedupe_key) do nothing;
  update reminders set status = 'a_envoyer' where id = m.id returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------------
-- Tâches quotidiennes (exécutées par le serveur, fuseau Europe/Paris)
-- ---------------------------------------------------------------------
create or replace function public.iz_daily_tasks(p_today date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, iz_today_paris());
  v_run uuid; v_generated int := 0; v_confirm int := 0; v_drafts int := 0; v_cancelled int := 0; k int;
  l record; c record; v_charges uuid[]; v_debt numeric; v_level int; v_names text; v_emails text[]; v_owner text; v_subject text; v_body text; v_tpl jsonb; v_rid uuid;
begin
  insert into job_runs (job, run_key) values ('daily', v_today::text || ':' || to_char(clock_timestamp(), 'HH24MISSMS'))
  returning id into v_run;

  -- 1. Échéances du mois en cours pour tous les baux actifs
  for l in select id from leases where start_date <= v_today and (end_date is null or end_date >= date_trunc('month', v_today)::date) loop
    v_generated := v_generated + iz_generate_rent_charges(l.id, v_today);
  end loop;

  -- 2. E-mail au propriétaire le lendemain de l'échéance (et jusqu'à 3 jours après) pour confirmer le paiement.
  --    L'absence de réponse ne vaut jamais confirmation : rien n'est enregistré sans action du propriétaire.
  for c in
    select rc.*, le.user_id as owner_id, u.email as owner_email, p.title as property_title
      from rent_charges rc join leases le on le.id = rc.lease_id join properties p on p.id = le.property_id join auth.users u on u.id = le.user_id
     where le.owner_confirmation_email and rc.cancelled_at is null
       and rc.due_date between v_today - 3 and v_today - 1
       and iz_charge_allocated(rc.id) < rc.rent_amount + rc.charges_amount
       and u.email is not null
  loop
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, lease_id, charge_id, dedupe_key)
    values (c.owner_id, 'confirmation_paiement', array[c.owner_email],
            'Loyer ' || to_char(c.period_start, 'MM/YYYY') || ' – ' || c.property_title || ' : avez-vous été payé ?',
            'Bonjour,' || chr(10) || chr(10) || 'Le loyer de ' || to_char(c.period_start, 'MM/YYYY') || ' pour « ' || c.property_title
              || ' » (' || iz_eur(c.rent_amount + c.charges_amount) || ' €) était dû le ' || to_char(c.due_date, 'DD/MM/YYYY') || '.'
              || chr(10) || 'Aucun paiement n''est encore enregistré dans Immo-Zen.' || chr(10) || chr(10)
              || 'Si vous l''avez reçu, confirmez-le dans Immo-Zen (Loyers et paiements). Sans confirmation de votre part, le loyer reste considéré comme non payé.',
            c.lease_id, c.id, 'confirmation:' || c.id)
    on conflict (dedupe_key) do nothing;
    get diagnostics k = row_count; v_confirm := v_confirm + k;
  end loop;

  -- 3. Relances : brouillon préparé quand le retard dépasse le délai choisi ; le propriétaire valide avant tout envoi.
  for l in select le.*, p.title as property_title, s.rental_settings
             from leases le join properties p on p.id = le.property_id left join user_settings s on s.user_id = le.user_id
            where le.reminder_enabled loop
    select coalesce(array_agg(rc.id order by rc.due_date), '{}') into v_charges
      from rent_charges rc
     where rc.lease_id = l.id and rc.cancelled_at is null and rc.due_date + l.reminder_delay_days <= v_today
       and iz_charge_allocated(rc.id) < rc.rent_amount + rc.charges_amount;
    continue when cardinality(v_charges) = 0;
    continue when exists (select 1 from reminders m where m.lease_id = l.id and m.status not in ('annule','echec')
                            and m.created_at > (v_today - l.reminder_delay_days)::timestamptz);
    v_debt := iz_charges_remaining(v_charges);
    select least(count(*) + 1, 3) into v_level from reminders m where m.lease_id = l.id and m.status in ('envoye','envoye_manuellement')
       and m.charge_ids && v_charges;
    select string_agg(trim(coalesce(t.first_name || ' ', '') || t.last_name), ', '),
           coalesce(array_agg(t.email) filter (where t.email is not null), '{}')
      into v_names, v_emails
      from lease_tenants lt join tenants t on t.id = lt.tenant_id where lt.lease_id = l.id and lt.left_on is null;
    v_tpl := coalesce(l.rental_settings -> 'reminder_templates' -> (v_level - 1), '{}'::jsonb);
    v_subject := coalesce(v_tpl ->> 'subject', case v_level when 1 then 'Rappel : loyer impayé' when 2 then 'Second rappel : loyer impayé' else 'Dernier rappel amiable : loyer impayé' end);
    v_body := coalesce(v_tpl ->> 'body',
      'Bonjour {locataires},' || chr(10) || chr(10)
      || 'Sauf erreur de notre part, la somme de {montant} € reste due au titre du logement {bien} (échéances : {periodes}).' || chr(10)
      || 'Pourriez-vous procéder au règlement ou nous contacter si une difficulté se présente ?' || chr(10) || chr(10)
      || 'Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.' || chr(10) || chr(10)
      || 'Cordialement,' || chr(10) || '{bailleur}');
    v_body := replace(replace(replace(replace(replace(v_body,
      '{locataires}', coalesce(v_names, '')),
      '{montant}', iz_eur(v_debt)),
      '{bien}', l.property_title),
      '{bailleur}', coalesce(l.landlord_name, '')),
      '{periodes}', (select string_agg(to_char(period_start, 'MM/YYYY'), ', ' order by period_start) from rent_charges where id = any(v_charges)));
    insert into reminders (user_id, lease_id, level, charge_ids, debt_amount, subject, body, recipients, status, created_by)
    values (l.user_id, l.id, v_level, v_charges, v_debt, left(v_subject, 300), v_body, v_emails, 'brouillon', 'automatique')
    returning id into v_rid;
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, reminder_id, lease_id, dedupe_key)
    select l.user_id, 'relance_a_valider', array[u.email], 'Relance à valider – ' || l.property_title,
           'Un loyer de « ' || l.property_title || ' » reste impayé (' || iz_eur(v_debt) || ' €).' || chr(10)
           || 'Une relance amiable a été préparée. Ouvrez Immo-Zen (Locataires et baux) pour la relire et l''envoyer : rien n''est envoyé au locataire sans votre validation.',
           v_rid, l.id, 'relance-a-valider:' || v_rid
      from auth.users u where u.id = l.user_id and u.email is not null
    on conflict (dedupe_key) do nothing;
    v_drafts := v_drafts + 1;
  end loop;

  -- 4. Arrêt des relances lorsque la dette est réglée
  update reminders m set status = 'annule', error = 'Dette réglée'
   where m.status in ('brouillon','a_envoyer') and iz_charges_remaining(m.charge_ids) <= 0;
  get diagnostics v_cancelled = row_count;
  update email_outbox o set status = 'annule'
   where o.status = 'a_envoyer' and o.kind in ('relance','relance_a_valider')
     and exists (select 1 from reminders m where m.id = o.reminder_id and m.status = 'annule');
  update email_outbox o set status = 'annule'
   where o.status = 'a_envoyer' and o.kind = 'confirmation_paiement'
     and exists (select 1 from rent_charges rc where rc.id = o.charge_id and iz_charge_allocated(rc.id) >= rc.rent_amount + rc.charges_amount);

  update job_runs set status = 'ok', finished_at = now(),
         details = jsonb_build_object('today', v_today, 'echeances', v_generated, 'confirmations', v_confirm, 'relances_preparees', v_drafts, 'relances_annulees', v_cancelled)
   where id = v_run;
  return (select details from job_runs where id = v_run);
end $$;
revoke all on function public.iz_daily_tasks(date) from public, anon, authenticated;

-- File d'e-mails : réservation des messages à envoyer (serveur uniquement)
create or replace function public.iz_claim_outbox(p_limit int default 20)
returns setof public.email_outbox language sql security definer set search_path = public as $$
  update email_outbox o set status = 'en_cours', attempts = attempts + 1
   where o.id in (select id from email_outbox
                   where (status = 'a_envoyer' or (status = 'en_cours' and scheduled_at < now() - interval '15 minutes'))
                     and scheduled_at <= now() and attempts < 5
                   order by scheduled_at limit p_limit for update skip locked)
  returning o.*
$$;
revoke all on function public.iz_claim_outbox(int) from public, anon, authenticated;

create or replace function public.iz_outbox_result(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o email_outbox%rowtype;
begin
  update email_outbox set
    status = case when p_ok then 'envoye' when attempts >= 5 then 'echec' else 'a_envoyer' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 1000) end,
    scheduled_at = case when p_ok then scheduled_at else now() + (interval '10 minutes' * power(2, attempts)) end
  where id = p_id returning * into o;
  if o.receipt_id is not null then
    update receipts set send_status = case when p_ok then 'envoye' when o.status = 'echec' then 'echec' else 'a_envoyer' end,
                        sent_at = case when p_ok then now() else sent_at end, send_error = o.last_error
     where id = o.receipt_id;
  end if;
  if o.reminder_id is not null and o.kind = 'relance' then
    update reminders set status = case when p_ok then 'envoye' when o.status = 'echec' then 'echec' else 'a_envoyer' end,
                         sent_at = case when p_ok then now() else sent_at end, error = o.last_error
     where id = o.reminder_id;
  end if;
end $$;
revoke all on function public.iz_outbox_result(uuid, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS et droits
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenants','leases','lease_tenants','rent_charges','payments','payment_allocations','deposit_movements',
                           'receipts','reminders','documents','expenses','email_outbox','job_runs','storage_deletions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  -- tables entièrement gérées par l'utilisateur (dans les limites des déclencheurs)
  foreach t in array array['tenants','leases','lease_tenants','rent_charges','payments','payment_allocations','deposit_movements','reminders','documents','expenses'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_own', t);
  end loop;
  -- lecture seule : quittances et file d'e-mails (écrites uniquement par les fonctions serveur)
  foreach t in array array['receipts','email_outbox'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_read', t);
  end loop;
  -- job_runs, storage_deletions : aucun accès utilisateur
end $$;

grant execute on function public.iz_generate_rent_charges(uuid, date) to authenticated;
grant execute on function public.iz_issue_receipt(uuid, text) to authenticated;
grant execute on function public.iz_cancel_receipt(uuid, text) to authenticated;
grant execute on function public.iz_queue_receipt_email(uuid) to authenticated;
grant execute on function public.iz_queue_reminder(uuid) to authenticated;
revoke execute on function public.iz_auto_receipt() from public, anon, authenticated;
revoke execute on function public.iz_document_deleted() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.iz_daily_tasks(date) to service_role';
    execute 'grant execute on function public.iz_claim_outbox(int) to service_role';
    execute 'grant execute on function public.iz_outbox_result(uuid, boolean, text) to service_role';
    execute 'grant select, update on public.email_outbox, public.receipts, public.storage_deletions, public.job_runs to service_role';
    execute 'grant delete on public.storage_deletions to service_role';
    execute 'grant insert on public.job_runs to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Stockage privé des documents
-- Chemin imposé : <id utilisateur>/<id document>/<nom de fichier>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array[
  'application/pdf','image/jpeg','image/png','image/webp','image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists iz_documents_read on storage.objects;
create policy iz_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists iz_documents_insert on storage.objects;
create policy iz_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists iz_documents_delete on storage.objects;
create policy iz_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
