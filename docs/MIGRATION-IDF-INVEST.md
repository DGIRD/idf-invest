# Reprise des données IDF Invest

## Ce qui existait (commit `aaf144f`, 10/10/2026)

- PWA HTML/JS sans framework, publiée sur GitHub Pages, authentification Supabase e-mail + mot de passe.
- `public.simulations` : `id, user_id, number, version, archived, data jsonb` — chaque simulation contient à la fois le bien, l'agence/agent et les hypothèses de calcul.
- `public.contacts` : `id, user_id, data jsonb` — **créée mais jamais alimentée** par l'interface.
- Aucun import/export, aucun état des lieux, aucun paiement.
- Défaut relevé : au chargement, la liste du serveur remplaçait le cache local sans comparaison ; une simulation enregistrée hors connexion et jamais synchronisée pouvait être perdue. Ces simulations sont récupérables par Paramètres → Données IDF Invest.

## Principes

1. **Additive** : aucune table IDF Invest n'est modifiée ni supprimée ; l'ancienne application fonctionne jusqu'à la bascule.
2. **Sauvegardée** : copie intégrale dans `immozen_backup.idf_simulations_20261013` et `immozen_backup.idf_contacts_20261013` (schéma non exposé à l'API).
3. **Idempotente** : `immozen_backup.migrate_idf_invest()` ne reprend que les simulations absentes (clé `properties.legacy_simulation_id`, unique).
4. **Réversible** : `supabase/rollback/20261013000200_migrate_idf_invest.down.sql` supprime exactement ce qui a été créé, puis `…core.down.sql` retire le schéma.

## Correspondances

| IDF Invest (`data`) | Immo-Zen |
|---|---|
| title, address, zip, city, surface, rooms, dpe, listingUrl, comments | `properties` (valeurs invalides écartées : DPE hors A-G, lien non http(s)) |
| propertyType | `property_type` (Appartement → appartement…) |
| status | Brouillon/Active → repéré · À approfondir → informations demandées · Visite programmée → visite programmée · Offre en cours → offre transmise · Retenue → offre acceptée · Refusée → refusé · Abandonnée → abandonné |
| archived = true | statut `archive`, statut d'origine dans `status_before_archive` |
| askingPrice, offerPrice, works | `asking_price`, `offer_price`, `works_budget` |
| loyer (bas/moyen/haut × surface, ou personnalisé) | `estimated_rent` et `monthlyRent` du scénario |
| agency | contact `agence`, dédoublonné par nom sans tenir compte de la casse |
| agentName, agentEmail, agentPhone | contact `agent` rattaché à l'agence, dédoublonné par e-mail (sinon par nom) |
| notaryFees | `notaryMode = amount`, `notaryAmount` (le montant saisi est conservé tel quel) |
| financeFees | `guaranteeFees` |
| tenantCharges, coproCharges, recoverableCharges, propertyTax, teom, pno, managementFees, gli, maintenance, vacancy, otherCharges | champs annuels/mensuels équivalents du scénario |
| number, rentM2Low/High, rentLevel, customRent, simplifiedMode, résultats calculés | conservés dans `scenarios.inputs.legacy` |
| `public.contacts.data` | contact « autre », données brutes copiées dans les notes |

Un événement « Reprise IDF Invest » est ajouté à l'historique de chaque bien.

## Exécution

Dans Supabase → SQL Editor, **sur le projet de test d'abord** :

1. `supabase/migrations/20261013000100_immozen_core.sql`
2. `supabase/migrations/20261013000200_migrate_idf_invest.sql` — affiche le nombre de biens et contacts repris.
3. Contrôle : `select count(*) from public.simulations;` doit égaler `select count(*) from public.properties where legacy_simulation_id is not null;`.

Relancer `select * from immozen_backup.migrate_idf_invest();` après la bascule reprend les simulations créées entre-temps dans l'ancienne application.

## Annulation

```sql
-- 1. supprimer les données reprises (les modifications faites depuis dans Immo-Zen sont perdues)
\i supabase/rollback/20261013000200_migrate_idf_invest.down.sql
-- 2. optionnel : retirer tout le schéma Immo-Zen
\i supabase/rollback/20261013000100_immozen_core.down.sql
```

Le cycle migration → annulation → ré-application est vérifié par `npm run test:db`.
