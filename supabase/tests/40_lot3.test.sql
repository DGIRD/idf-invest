-- Tests SQL du lot 3 : import de relevés, catégories, saisies fiscales. Exécuté après 30_lot2.test.sql.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.expenses (property_id, expense_date, amount, category, nature, payment_status, paid_on, label, account, import_ref) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '2023-04-27', 319.35, 'copropriete', 'charge', 'paye', '2023-04-27', 'VIREMENT A SYNDICAT', 'Compte La banque postale', 'imp:abc:1'),
  ('aaaaaaaa-1111-0000-0000-000000000001', '2024-05-05', 850, 'loyer', 'tresorerie', 'paye', '2024-05-05', 'VIR LOYER', 'Compte La banque postale', 'imp:def:1');
select tests.ok((select count(*) from public.expenses where import_ref is not null) = 2, 'import : nouvelles catégories (loyer) et compte acceptés');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, payment_status, paid_on, import_ref)
  values ('aaaaaaaa-1111-0000-0000-000000000001', '2023-04-27', 319.35, 'copropriete', 'paye', '2023-04-27', 'imp:abc:1') $q$,
  'import : même ligne de relevé refusée (anti-doublon)');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, payment_status, paid_on)
  values ('aaaaaaaa-1111-0000-0000-000000000001', '2023-04-27', 10, 'inconnue', 'paye', '2023-04-27') $q$,
  'import : catégorie inconnue refusée');
update public.user_settings set tax_inputs = '{"2024":{"aaaaaaaa-1111-0000-0000-000000000001":{"regularisation":100}}}';
select tests.ok((select tax_inputs #>> '{2024,aaaaaaaa-1111-0000-0000-000000000001,regularisation}' from public.user_settings) = '100', 'saisies fiscales enregistrées');
commit;

-- Un autre compte peut importer une ligne de même empreinte, sans voir celles d'Alice
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.ok((select count(*) from public.expenses) = 0, 'import : lignes importées invisibles pour un autre compte');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, payment_status, paid_on, import_ref)
  values ('aaaaaaaa-1111-0000-0000-000000000001', '2023-04-27', 319.35, 'copropriete', 'paye', '2023-04-27', 'imp:abc:1') $q$,
  'import : impossible de rattacher une ligne au bien d''un autre compte');
commit;

select 'Tests SQL du lot 3 passés' as fin;
