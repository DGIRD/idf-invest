# État du projet — lot 1 (13 octobre 2026)

Légende : **Implémenté et testé** = code livré et couvert par un test automatisé exécuté · **Implémenté** = code livré, vérifié à la main seulement · **À configurer** = code livré, nécessite un service externe · **Restant** = non commencé.

## Livré dans le lot 1

| Fonction | État | Preuve |
|---|---|---|
| Analyse d'IDF Invest et reprise des données (simulations → biens + scénarios + contacts agence/agent dédoublonnés) | Implémenté et testé | `supabase/tests` (16 vérifications), e2e |
| Sauvegarde préalable et annulation de la reprise | Implémenté et testé | test de réversibilité SQL |
| Reprise des simulations IDF Invest restées dans le navigateur (hors connexion) | Implémenté et testé | e2e |
| Schéma PostgreSQL, verrou optimiste, RLS par utilisateur | Implémenté et testé | tests SQL deux comptes |
| Connexion, création de compte, mot de passe oublié (Supabase Auth) | À configurer | testé en mode démonstration uniquement ; nécessite le projet Supabase |
| Menu complet ; rubriques des lots 2-3 marquées « non disponibles » | Implémenté et testé | e2e |
| États des lieux : supprimés (menu, écrans, routes, code) | Implémenté et testé | e2e vérifie le code livré ; IDF Invest n'en contenait pas |
| Prospection : tableau (recherche, tri, filtres, pagination, sélection multiple, colonnes personnalisables, actions, cartes mobiles) | Implémenté et testé | e2e |
| 15 statuts d'acquisition, statuts d'occupation distincts | Implémenté et testé | SQL + unitaires |
| Passage à « Acquis » → Mes biens, même ligne, historique conservé, photographie des hypothèses | Implémenté et testé | SQL + e2e |
| Ajout direct d'un bien détenu | Implémenté et testé | SQL + e2e |
| Fiche bien : commentaires, échanges, tâches, simulations, vigilance | Implémenté et testé (échanges, simulations) / implémenté (tâches) | e2e |
| Duplication, archivage, comparaison (2 à 4 biens) | Implémenté et testé | e2e + SQL |
| Simulateur : paramètres par défaut modifiables, honoraires inclus/exclus, différé partiel/total, amortissement, rendements, cash-flow | Implémenté et testé | 15 tests unitaires |
| Plusieurs scénarios par bien, scénario principal | Implémenté et testé | e2e |
| Contacts immobiliers : coordonnées, organisme, secteur, biens liés, échanges, relance | Implémenté et testé | e2e |
| Tableau de bord (relances, visites, tâches, parcours) | Implémenté | captures |
| Exports Excel .xlsx réel, CSV, JSON ; amortissement en .xlsx | Implémenté et testé | relu par openpyxl + e2e |
| Sauvegarde JSON complète, import avec aperçu, doublons, sauvegarde préalable | Implémenté et testé | unitaires + e2e |
| État de synchronisation visible, détection des conflits sans écrasement silencieux | Implémenté et testé | SQL + e2e |
| Hors connexion : consultation seule des données chargées ; aucune écriture simulée | Implémenté | vérifié à la main |
| Purge du cache privé à la déconnexion | Implémenté et testé | e2e |
| PWA installable (manifeste, service worker sans cache des données) | Implémenté | — |
| Rendu mobile 390 px sans défilement horizontal | Implémenté et testé | e2e + captures |
| CI GitHub Actions et déploiement GitHub Pages | À configurer | workflows livrés, non exécutés ici |

## Restant

**Lot 2 — gestion locative** : locataires, baux successifs, colocations, dépôt de garantie séparé ; échéances, paiements multiples/partiels/trop-perçus, soldes calculés ; e-mail mensuel de confirmation au propriétaire ; quittances PDF (période intégralement réglée seulement) et reçus ; relances d'impayés ; dépenses et justificatifs ; stockage privé des documents et photos ; tâches serveur (Edge Functions + planification, fuseau Europe/Paris, journal, anti-doublons).

**Lot 3 — plateforme** : abonnements Stripe (mensuel/annuel, webhooks vérifiés côté serveur, renouvellement, résiliation, échec, remboursement, expiration, événements dupliqués) ; contrôle d'accès par abonnement dans les règles RLS ; parcours d'invitation sans mot de passe en clair ; Mon abonnement ; administration (utilisateurs, tarifs, incidents, e-mails, journal, prospects commerciaux séparés, accès support journalisé) ; synthèse annuelle selon le régime renseigné ; import CSV.

## Limites connues

- **Création de compte ouverte** tant que l'abonnement (lot 3) n'existe pas : n'importe qui peut créer un compte et utiliser l'application gratuitement.
- **Pas de projet Supabase ni de navigateur connecté au réseau** pendant ce lot : l'authentification réelle, les appels PostgREST et la reprise sur la base de production n'ont pas été exécutés. Les migrations sont testées sur PostgreSQL 16 avec une émulation minimale de Supabase (`auth.uid()`, rôles). Une recette sur un projet Supabase de test est indispensable avant la production (voir DEPLOIEMENT).
- La CI installe les vraies dépendances npm ; en local, ce lot a été vérifié avec des versions déjà présentes (React 19.2, TypeScript 6.0, supabase-js 2.117 compilé depuis ses sources). Aucun fichier de verrouillage `package-lock.json` n'a pu être généré : à commiter après le premier `npm install`.
- Les icônes sont encore celles d'IDF Invest.
- Copie locale des données (lecture hors connexion) stockée en clair dans le navigateur, effacée à la déconnexion. À éviter sur un appareil partagé sans déconnexion.
- Taille du script : ~600 Ko minifié (≈170 Ko compressé). Découpage prévu si nécessaire.
- Le cash-flow « réel » de Mes biens attend les paiements et dépenses (lot 2) ; seul le cash-flow simulé est affiché, et étiqueté comme tel.
- Les résultats des simulations reprises peuvent différer d'IDF Invest, dont le « mode simplifié » mélangeait loyer charges comprises et charges partielles. Les anciennes valeurs sont conservées dans `inputs.legacy.results`.
