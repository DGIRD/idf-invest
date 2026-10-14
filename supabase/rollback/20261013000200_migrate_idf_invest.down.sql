-- Annulation de la reprise IDF Invest.
-- Supprime uniquement ce que la migration a créé (repéré par legacy_simulation_id / legacy_source).
-- ATTENTION : les modifications faites dans Immo-Zen sur ces biens depuis la migration
-- seront perdues. Les tables d'origine public.simulations / public.contacts n'ont
-- jamais été modifiées ; la sauvegarde immozen_backup.* est conservée.
begin;
delete from public.properties where legacy_simulation_id is not null;     -- scénarios, tâches, historique : en cascade
delete from public.scenarios where legacy_simulation_id is not null;
delete from public.pro_contacts where legacy_source = 'idf-invest' or legacy_source like 'idf-invest-contacts:%';
drop function if exists immozen_backup.migrate_idf_invest();
commit;

-- Restauration des tables d'origine depuis la sauvegarde (uniquement si elles ont été
-- altérées par une intervention manuelle) :
--   truncate public.simulations; insert into public.simulations select * from immozen_backup.idf_simulations_20261013;
--   truncate public.contacts;    insert into public.contacts    select * from immozen_backup.idf_contacts_20261013;
