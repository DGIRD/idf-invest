\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- Exécuté après les scripts d'annulation : vérifie la réversibilité.
select tests.ok(to_regclass('public.properties') is null, 'annulation : tables Immo-Zen supprimées');
select tests.ok((select count(*) from public.simulations) = 3, 'annulation : simulations IDF Invest toujours présentes');
select tests.ok((select count(*) from public.contacts) = 1, 'annulation : contacts IDF Invest toujours présents');
select tests.ok((select count(*) from immozen_backup.idf_simulations_20261013) = 3, 'annulation : sauvegarde conservée');
\echo 'Réversibilité vérifiée.'
