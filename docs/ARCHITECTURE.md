# Architecture

## Choix

| Besoin | Choix | Remarque |
|---|---|---|
| Interface | React 19 + TypeScript strict | conforme à la proposition |
| Build | **esbuild** (`scripts/build.mjs`) au lieu de Vite | substitution assumée : un seul outil, sans plugin, build identique en local et en CI ; refuse une clé secrète dans le frontend ; génère un service worker versionné |
| Données et comptes | Supabase : PostgreSQL + Auth (flux PKCE) | `@supabase/supabase-js` 2.x |
| Règles métier critiques | Côté serveur, dans PostgreSQL | déclencheurs (statut « acquis », historique, versions) et RLS |
| Fichiers privés | Supabase Storage (lot 2) | — |
| Paiements, e-mails, tâches planifiées | Supabase Edge Functions + planification (lots 2-3) | — |
| Abonnements | Stripe (lot 3) ; Payment Links conservables si les webhooks suffisent | — |
| Diffusion | PWA sur GitHub Pages | installable depuis le navigateur ; **ce n'est pas une application publiée sur un store** |

Routage par ancre (`#/prospection`) : compatible avec un hébergement statique sans réécriture d'URL.

## Structure

```
src/
  domain/      fonctions pures testées : simulateur, règles des biens, reprise, sauvegarde, exports
  data/        types, interface Repo, Supabase, mode démonstration, store (synchronisation, conflits)
  ui/          composants, tableau générique, mise en page, routeur
  pages/       écrans
supabase/
  migrations/  SQL versionné, appliqué dans l'ordre
  rollback/    scripts d'annulation
  tests/       tests SQL sur PostgreSQL local (émulation de auth.uid)
tests/         tests unitaires (node:test) et parcours navigateur (Playwright)
legacy/        ancienne version de l'application, pour référence (non publiée)
```

## Une table, deux vues

`properties` contient tous les biens. Prospection = `status <> 'acquis'` ; Mes biens = `status = 'acquis'`. Le passage à « acquis » ne copie rien : même identifiant, même historique. Le statut d'occupation n'est autorisé que pour un bien acquis (contrainte SQL).

## Synchronisation

- Chaque ligne porte une `version` incrémentée par le serveur. Le client met à jour « là où la version vaut celle que j'ai lue » : si aucune ligne ne correspond, conflit → l'utilisateur choisit de recharger ou de remplacer. Jamais d'écrasement silencieux.
- Rechargement au retour de connexion et au retour sur l'onglet (au plus toutes les 30 s).
- Hors connexion : lecture de la dernière copie, écritures refusées avec un message clair.
- Le service worker ne met en cache que les fichiers de l'application, jamais les réponses API.

## Mode démonstration

Sans projet Supabase configuré (ou avec `?demo` hors production), un dépôt local remplace Supabase. Bandeau permanent ; aucun e-mail ni paiement. Le déploiement de production refuse de publier dans ce mode.

## Environnements

Un projet Supabase par environnement (développement, test, production), configurés par variables `IMMOZEN_*` (`.env` en local, variables GitHub en CI). Les migrations sont appliquées d'abord sur le projet de test.
