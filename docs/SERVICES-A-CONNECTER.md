# Services à connecter

| Service | Usage | Lot | État | Action |
|---|---|---|---|---|
| Supabase (projet existant) | base, comptes, RLS | 1 | **À configurer** | exécuter les migrations, régler Auth (DEPLOIEMENT) |
| Supabase (projet de test) | recette | 1 | **À créer** | — |
| GitHub Pages (Actions) | hébergement | 1 | **À configurer** | source « GitHub Actions » + variables |
| Supabase Storage | documents et photos privés | 2 | **Créé par la migration** | bucket « documents » privé et politiques inclus dans la migration du lot 2 |
| Resend (ou autre fournisseur) | confirmations de paiement, quittances, relances | 2 | **À configurer** | compte, domaine vérifié (SPF, DKIM), clé d'API en secret de fonction |
| Supabase Edge Functions + pg_cron/pg_net | tâches serveur | 2 | **À configurer** | `supabase functions deploy daily`, `scheduling.example.sql` ([TACHES-SERVEUR](TACHES-SERVEUR.md)) |
| Stripe | abonnements mensuel et annuel | 3 | Restant — **aucun compte** | créer le compte, mode test, produits et prix, webhook |
| Génération PDF | quittances, reçus | 2 | Livré | pdf-lib dans le navigateur et la fonction serveur ; modèle à relire |

Aucun de ces services n'a été contacté ou configuré pendant ce lot.
