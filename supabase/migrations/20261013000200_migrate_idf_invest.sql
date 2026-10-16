-- =====================================================================
-- Immo-Zen – Lot 1 : reprise des données IDF Invest
--
-- 1. Sauvegarde intégrale des tables historiques dans le schéma privé
--    immozen_backup (non exposé à l'API, inaccessible aux utilisateurs).
-- 2. Fonction idempotente immozen_backup.migrate_idf_invest() :
--    chaque simulation IDF Invest devient
--      • un bien en prospection (properties, legacy_simulation_id = id d'origine)
--      • un scénario de simulation lié (scenarios)
--      • l'agence et l'agent en contacts (pro_contacts), dédoublonnés par utilisateur
--    Les lignes de public.contacts (table jamais alimentée par l'interface
--    IDF Invest) sont reprises en contacts « autre » si elles existent.
-- 3. Les tables d'origine restent intactes : l'ancienne application
--    continue de fonctionner. Annulation : supabase/rollback/…migrate….down.sql
-- =====================================================================

create schema if not exists immozen_backup;
revoke all on schema immozen_backup from public, anon, authenticated;

do $$
begin
  if to_regclass('public.simulations') is not null and to_regclass('immozen_backup.idf_simulations_20261013') is null then
    execute 'create table immozen_backup.idf_simulations_20261013 as table public.simulations';
  end if;
  if to_regclass('public.contacts') is not null and to_regclass('immozen_backup.idf_contacts_20261013') is null then
    execute 'create table immozen_backup.idf_contacts_20261013 as table public.contacts';
  end if;
end $$;

-- Conversion tolérante d'une valeur JSON en nombre (null si absent ou invalide)
create or replace function immozen_backup.num(v jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then null
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and replace(trim(v #>> '{}'), ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then replace(trim(v #>> '{}'), ',', '.')::numeric
    else null
  end
$$;

create or replace function immozen_backup.txt(v jsonb)
returns text
language sql
immutable
as $$
  select nullif(trim(coalesce(v #>> '{}', '')), '')
$$;

create or replace function immozen_backup.map_status(s text)
returns text
language sql
immutable
as $$
  select case s
    when 'Brouillon' then 'repere'
    when 'Active' then 'repere'
    when 'À approfondir' then 'informations_demandees'
    when 'Visite programmée' then 'visite_programmee'
    when 'Offre en cours' then 'offre_transmise'
    when 'Retenue' then 'offre_acceptee'
    when 'Refusée' then 'refuse'
    when 'Abandonnée' then 'abandonne'
    else 'repere'
  end
$$;

create or replace function immozen_backup.map_type(s text)
returns text
language sql
immutable
as $$
  select case s
    when 'Appartement' then 'appartement' when 'Maison' then 'maison' when 'Immeuble' then 'immeuble'
    when 'Parking' then 'parking' when 'Local' then 'local' else 'appartement'
  end
$$;

create or replace function immozen_backup.migrate_idf_invest()
returns table (migrated_properties int, migrated_contacts int, skipped int)
language plpgsql
security definer
set search_path = public, immozen_backup
as $$
declare
  s record;
  d jsonb;
  v_agency uuid;
  v_agent uuid;
  v_property uuid;
  v_scenario uuid;
  v_surface numeric;
  v_rent numeric;
  v_low numeric;
  v_high numeric;
  v_email text;
  v_props int := 0;
  v_contacts int := 0;
  v_skipped int := 0;
  v_status text;
  v_count_before int;
begin
  if to_regclass('public.simulations') is null then
    return query select 0, 0, 0;
    return;
  end if;

  select count(*) into v_count_before from public.pro_contacts;

  for s in
    select x.* from public.simulations x
    where not exists (select 1 from public.properties p where p.legacy_simulation_id = x.id)
      and exists (select 1 from auth.users u where u.id = x.user_id)
    order by x.created_at
  loop
    d := coalesce(s.data, '{}'::jsonb);

    -- Agence
    v_agency := null;
    if txt(d->'agency') is not null then
      select c.id into v_agency from public.pro_contacts c
       where c.user_id = s.user_id and c.kind = 'agence' and lower(c.name) = lower(txt(d->'agency'))
       limit 1;
      if v_agency is null then
        insert into public.pro_contacts (user_id, kind, name, legacy_source)
        values (s.user_id, 'agence', left(txt(d->'agency'), 200), 'idf-invest')
        returning id into v_agency;
      end if;
    end if;

    -- Agent (dédoublonné par e-mail, sinon par nom)
    v_agent := null;
    v_email := lower(txt(d->'agentEmail'));
    if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
    if txt(d->'agentName') is not null or v_email is not null then
      select c.id into v_agent from public.pro_contacts c
       where c.user_id = s.user_id and c.kind = 'agent'
         and ((v_email is not null and lower(c.email) = v_email)
              or (v_email is null and lower(c.name) = lower(coalesce(txt(d->'agentName'), ''))))
       limit 1;
      if v_agent is null then
        insert into public.pro_contacts (user_id, kind, name, email, phone, organization_id, organization_name, legacy_source)
        values (s.user_id, 'agent', left(coalesce(txt(d->'agentName'), v_email), 200), v_email,
                left(txt(d->'agentPhone'), 40), v_agency, left(txt(d->'agency'), 200), 'idf-invest')
        returning id into v_agent;
      end if;
    end if;

    -- Loyer retenu, selon la logique de l'ancienne application
    v_surface := nullif(num(d->'surface'), 0);
    v_low := coalesce(v_surface, 0) * coalesce(num(d->'rentM2Low'), 0);
    v_high := coalesce(v_surface, 0) * coalesce(num(d->'rentM2High'), 0);
    v_rent := case txt(d->'rentLevel')
      when 'Bas' then v_low when 'Haut' then v_high when 'Moyen' then (v_low + v_high) / 2
      else coalesce(num(d->'customRent'), 0) end;

    v_status := map_status(txt(d->'status'));

    insert into public.properties (
      user_id, title, status, status_before_archive, property_type, address, zip, city, surface, rooms, dpe,
      listing_url, asking_price, offer_price, works_budget, estimated_rent, agency_id, agent_id, comments,
      legacy_simulation_id, legacy_ref, created_at)
    values (
      s.user_id, left(coalesce(txt(d->'title'), s.number, 'Bien importé'), 200),
      case when s.archived then 'archive' else v_status end,
      case when s.archived then v_status end,
      map_type(txt(d->'propertyType')),
      left(txt(d->'address'), 300), left(txt(d->'zip'), 12), left(txt(d->'city'), 120),
      v_surface, nullif(num(d->'rooms'), 0)::int,
      case when txt(d->'dpe') in ('A','B','C','D','E','F','G') then txt(d->'dpe') end,
      case when txt(d->'listingUrl') ~* '^https?://' then txt(d->'listingUrl') end,
      num(d->'askingPrice'), num(d->'offerPrice'), num(d->'works'), round(v_rent, 2),
      v_agency, v_agent, txt(d->'comments'), s.id, s.number, s.created_at)
    returning id into v_property;

    insert into public.scenarios (user_id, property_id, name, inputs, results, engine_version, legacy_simulation_id, created_at)
    values (s.user_id, v_property, 'Simulation reprise ' || coalesce(s.number, ''),
      jsonb_build_object(
        'priceMode', 'hors_honoraires',
        'price', coalesce(num(d->'offerPrice'), 0),
        'agencyFees', coalesce(num(d->'agencyFees'), 0),
        'notaryMode', 'amount',
        'notaryRate', 7.5,
        'notaryAmount', coalesce(num(d->'notaryFees'), 0),
        'works', coalesce(num(d->'works'), 0),
        'furniture', coalesce(num(d->'furniture'), 0),
        'guaranteeFees', coalesce(num(d->'financeFees'), 0),
        'dossierFees', 0,
        'downPayment', coalesce(num(d->'downPayment'), 0),
        'useLoan', true,
        'interestRate', coalesce(num(d->'interestRate'), 0),
        'loanYears', greatest(coalesce(num(d->'loanYears'), 20), 1),
        'insuranceRate', coalesce(num(d->'insuranceRate'), 0),
        'deferralMonths', 0,
        'deferralType', 'aucun',
        'monthlyRent', round(v_rent, 2),
        'chargesProvisionMonthly', coalesce(num(d->'tenantCharges'), 0),
        'coproChargesAnnual', coalesce(num(d->'coproCharges'), 0),
        'coproRecoverableAnnual', coalesce(num(d->'recoverableCharges'), 0),
        'propertyTaxAnnual', coalesce(num(d->'propertyTax'), 0),
        'propertyTaxRecoverableAnnual', coalesce(num(d->'teom'), 0),
        'pnoAnnual', coalesce(num(d->'pno'), 0),
        'managementAnnual', coalesce(num(d->'managementFees'), 0),
        'gliAnnual', coalesce(num(d->'gli'), 0),
        'maintenanceAnnual', coalesce(num(d->'maintenance'), 0),
        'vacancyAnnual', coalesce(num(d->'vacancy'), 0),
        'otherChargesAnnual', coalesce(num(d->'otherCharges'), 0),
        'legacy', jsonb_build_object(
          'number', s.number, 'version', s.version,
          'rentM2Low', num(d->'rentM2Low'), 'rentM2High', num(d->'rentM2High'),
          'rentLevel', txt(d->'rentLevel'), 'customRent', num(d->'customRent'),
          'simplifiedMode', d->'simplifiedMode',
          'results', jsonb_build_object(
            'totalInvestment', num(d->'totalInvestment'), 'loanAmount', num(d->'loanAmount'),
            'totalPayment', num(d->'totalPayment'), 'cashflowMonthly', num(d->'cashflowMonthly'),
            'grossYield', num(d->'grossYield'), 'netYield', num(d->'netYield')))),
      null, 'legacy-idf-invest', s.id, s.created_at)
    returning id into v_scenario;

    update public.properties set primary_scenario_id = v_scenario where id = v_property;

    insert into public.timeline_events (user_id, property_id, kind, summary, data)
    values (s.user_id, v_property, 'migration', 'Repris de l''ancienne version (' || coalesce(s.number, s.id::text) || ')',
            jsonb_build_object('legacy_simulation_id', s.id, 'legacy_status', txt(d->'status'), 'archived', s.archived));

    v_props := v_props + 1;
  end loop;

  -- Table public.contacts (données libres en jsonb)
  if to_regclass('public.contacts') is not null then
    insert into public.pro_contacts (user_id, kind, name, email, phone, notes, legacy_source, created_at)
    select c.user_id, 'autre',
           left(coalesce(txt(c.data->'name'), txt(c.data->'nom'), txt(c.data->'agentName'), txt(c.data->'email'), 'Contact importé'), 200),
           case when lower(txt(c.data->'email')) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(txt(c.data->'email')) end,
           left(coalesce(txt(c.data->'phone'), txt(c.data->'telephone')), 40),
           'Import de l''ancienne version : ' || left(c.data::text, 15000),
           'idf-invest-contacts:' || c.id::text, c.created_at
      from public.contacts c
     where exists (select 1 from auth.users u where u.id = c.user_id)
       and not exists (select 1 from public.pro_contacts p where p.legacy_source = 'idf-invest-contacts:' || c.id::text);
  end if;

  select count(*) - v_count_before into v_contacts from public.pro_contacts;
  select count(*) into v_skipped from public.simulations x
   where not exists (select 1 from public.properties p where p.legacy_simulation_id = x.id);

  return query select v_props, v_contacts, v_skipped;
end;
$$;

revoke all on function immozen_backup.migrate_idf_invest() from public, anon, authenticated;

-- Exécution (idempotente : relancer ne crée pas de doublons)
select * from immozen_backup.migrate_idf_invest();
