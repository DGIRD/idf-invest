# Tests et résultats

Exécution du 13/10/2026 sur la branche `immo-zen`.

| Suite | Commande | Résultat |
|---|---|---|
| Typage strict (`strict`, `noUncheckedIndexedAccess`) | `npm run typecheck` | 0 erreur |
| Unitaires : simulateur (15), règles des biens, reprise locale, sauvegarde/import, CSV, XLSX relu par openpyxl (8) | `npm test` | **23/23** |
| SQL : reprise (16), isolation entre deux comptes (13), règles métier et concurrence (16), création de compte (2), annulation et ré-application (5) | `npm run test:db` | **52/52** |
| Navigateur (Chromium, bureau 1360 px et mobile 390 px, mode démonstration) | `npm run build && npm run test:e2e` | **20/20 étapes** |

## Couverture des exigences minimales

| Exigence | Couvert par |
|---|---|
| Création et connexion | e2e (mode démonstration) ; création de profil automatique en SQL. **Non testé contre un vrai Supabase Auth** |
| Isolation de deux utilisateurs | SQL |
| Sauvegarde et synchronisation | e2e (enregistrement, conflit), SQL (verrou optimiste) |
| Transfert prospect → Mes biens | SQL + e2e (même id, nombre de biens inchangé, historique, photographie) |
| Calculs | unitaires |
| Imports et exports | unitaires + e2e |
| Rendu mobile | e2e (aucun défilement horizontal, cartes, menu) + captures |
| Absence des états des lieux | e2e (menu, routes, code livré) |
| Paiements partiels, quittances, doublons d'envoi, abonnement | lots 2-3 |

Les captures d'écran sont produites dans `test-results/` (artefact de la CI).
