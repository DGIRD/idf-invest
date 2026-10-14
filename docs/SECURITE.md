# Sécurité

## Isolation des données

- RLS activé sur toutes les tables Immo-Zen ; politique `user_id = auth.uid()` en lecture et en écriture. Accès anonyme révoqué.
- Clés étrangères composites `(id, user_id)` : impossible de rattacher un scénario, une tâche, un échange ou une agence à un objet d'un autre compte, même en connaissant son identifiant.
- Le propriétaire d'une ligne ne peut pas être modifié (déclencheur).
- L'historique système (création, changement de statut, acquisition, reprise) n'est écrit que par le serveur ; l'utilisateur ne peut ajouter ou supprimer que ses échanges et notes ; aucune modification d'historique.
- Sauvegarde et fonction de reprise dans le schéma `immozen_backup`, inaccessible aux rôles de l'API.
- Les prospects commerciaux de la plateforme (lot 3) seront dans une table séparée, réservée aux administrateurs ; aucun accès administrateur aux données privées des abonnés par défaut.

Vérifié par `npm run test:db` avec deux comptes (lecture, modification, suppression, création au nom d'autrui, rattachement croisé, accès anonyme).

## Secrets

- Le frontend ne contient que l'URL et la clé **publique** du projet. Le build échoue si la clé fournie est une clé `service_role` ou `sb_secret_`.
- Aucun secret dans le dépôt ; `.env` ignoré par git. Les secrets serveur (Stripe, e-mail) iront dans les secrets des Edge Functions (lots 2-3).

## Comptes

- Mots de passe gérés par Supabase Auth ; jamais transmis ni affichés par l'application. Réinitialisation par lien e-mail (PKCE).
- À configurer dans Supabase : longueur minimale 10, confirmation d'e-mail, protection contre les mots de passe divulgués, limitation de débit (Auth → Rate limits), URL de redirection limitées au domaine de l'application.

## Entrées

Validation côté client (formulaires, simulateur, import) **et** côté serveur (contraintes SQL : longueurs, formats e-mail et URL, valeurs positives, statuts autorisés). Les exports CSV neutralisent les formules (`=`, `+`, `-`, `@`). L'import JSON est validé, limité à 20 Mo, et crée de nouveaux identifiants.

## Appareil

- Copie des données en lecture hors connexion dans le stockage du navigateur, effacée à la déconnexion (ainsi que le stockage de session). Le service worker ne stocke aucune donnée privée.
- Les journaux du navigateur ne contiennent pas de données personnelles émises volontairement par l'application.

## Points à traiter avant la production

- Désactiver la création de compte libre lorsque l'abonnement existera (lot 3), ou la conserver en connaissance de cause.
- Activer les sauvegardes quotidiennes / PITR du projet Supabase de production.
- Protéger les comptes administrateurs (MFA) dès le lot 3.
