-- À exécuter une seule fois dans Supabase > SQL Editor
create extension if not exists pgcrypto;
create table if not exists public.simulations (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, number text not null, version int not null default 1, archived boolean not null default false, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.contacts (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.simulations enable row level security; alter table public.contacts enable row level security;
drop policy if exists simulations_own on public.simulations; create policy simulations_own on public.simulations for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists contacts_own on public.contacts; create policy contacts_own on public.contacts for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create index if not exists simulations_user_idx on public.simulations(user_id,updated_at desc); create index if not exists contacts_user_idx on public.contacts(user_id,updated_at desc);
