# Services à connecter

| Service | Usage | Lot | État | Action |
|---|---|---|---|---|
| Supabase (projet existant d'IDF Invest) | base, comptes, RLS | 1 | **À configurer** | exécuter les migrations, régler Auth (DEPLOIEMENT) |
| Supabase (projet de test) | recette | 1 | **À créer** | — |
| GitHub Pages (Actions) | hébergement | 1 | **À configurer** | source « GitHub Actions » + variables |
| Supabase Storage | documents et photos privés | 2 | Restant | bucket privé, politiques par utilisateur |
| Fournisseur d'e-mails (ex. Resend, Brevo, SMTP) | confirmations de paiement, quittances, relances, invitations | 2-3 | Restant | domaine d'envoi vérifié (SPF, DKIM) |
| Supabase Edge Functions + planification | tâches serveur, webhooks | 2-3 | Restant | — |
| Stripe | abonnements mensuel et annuel | 3 | Restant — **aucun compte** | créer le compte, mode test, produits et prix, webhook |
| Génération PDF | quittances, reçus | 2 | Restant | côté serveur, modèles à valider |

Aucun de ces services n'a été contacté ou configuré pendant ce lot.
