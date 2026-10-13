# Guide utilisateur — lot 1

## Se connecter

Utilisez le même e-mail et le même mot de passe qu'avec IDF Invest : vos simulations ont été reprises en biens de prospection. « Mot de passe oublié » envoie un lien de réinitialisation. Sur téléphone ou ordinateur, le navigateur propose d'**installer** l'application (icône sur l'écran d'accueil).

L'indicateur en haut à droite montre l'état : *Synchronisé*, *Enregistrement…*, *Hors connexion* ou *Erreur*. Cliquez dessus pour resynchroniser. Hors connexion, vous consultez la dernière version chargée mais ne pouvez rien modifier.

## Prospection

Les biens que vous étudiez. **Ajouter un bien** : titre obligatoire, le reste au fil de l'eau. Vous pouvez créer l'agence et l'agent directement depuis le formulaire.

Le tableau se recherche, se trie (clic sur un en-tête), se filtre (en cours, refusés, archivés, statut précis, relances dues), se pagine. **Colonnes** choisit les colonnes affichées (mémorisé sur l'appareil). Cochez des lignes pour changer leur statut, les comparer (2 à 4) ou les exporter. Le menu « ⋯ » de chaque ligne : ouvrir, modifier, simuler, dupliquer, marquer comme acquis, archiver, supprimer.

La **fiche** regroupe caractéristiques, éléments de vigilance, commentaires, simulations, historique et échanges (appel, e-mail, visite… avec le contact concerné), tâches à échéance.

Aucun import automatique depuis les portails d'annonces : collez le lien de l'annonce dans la fiche.

## Passer un bien en « Acquis »

Bouton **Marquer comme acquis** (ou statut « Acquis »). Après confirmation, le bien quitte la prospection et apparaît dans **Mes biens**, avec tout son historique. Les hypothèses de son scénario principal sont figées (« photographie à l'acquisition ») : elles ne changeront plus, même si vous retouchez le scénario. Une erreur ? « Revenir en prospection » dans le menu Plus.

## Mes biens

Les biens détenus, acquis depuis la prospection ou ajoutés directement (**Ajouter un bien détenu**) : mode de détention, régime fiscal renseigné, date et coût d'acquisition, occupation. Locataires, loyers encaissés, dépenses et cash-flow réel arrivent au lot 2 ; le cash-flow affiché est celui de la simulation.

## Simulateur

Accessible seul ou depuis un bien (pré-rempli avec prix, travaux et loyer estimé). Les résultats se mettent à jour à chaque saisie. Indiquez si le prix inclut les honoraires d'agence pour éviter de les compter deux fois. Enregistrez plusieurs scénarios par bien ; le premier devient le **scénario principal** (modifiable dans l'onglet Simulations de la fiche), utilisé dans les tableaux et la comparaison. Le tableau d'amortissement s'affiche par année ou par mois et s'exporte en Excel. « Méthode de calcul » détaille les formules. Les valeurs par défaut se règlent dans **Paramètres**.

Les résultats sont avant impôts et ne constituent pas un conseil financier.

## Contacts

Agences, agents, artisans, notaires, banques… avec coordonnées, organisme, secteur, notes, date de relance, biens liés et échanges.

## Sauvegarde, export, import

- Chaque tableau s'exporte en Excel (.xlsx), CSV (séparateur « ; », pour Excel en français) ou JSON.
- **Paramètres → Télécharger une sauvegarde** : tout votre compte en un fichier JSON. **Importer une sauvegarde** affiche un aperçu, ignore les doublons et télécharge d'abord une sauvegarde de l'état actuel.
- **Données IDF Invest** : si des simulations de l'ancienne application n'avaient jamais été synchronisées depuis ce navigateur, elles sont proposées ici pour reprise.

## Déconnexion

Elle efface la copie locale des données sur l'appareil. Déconnectez-vous sur un appareil partagé.

## Guide administrateur

L'administration (utilisateurs, abonnements, tarifs, incidents, e-mails) arrive au lot 3. D'ici là, l'administration se fait dans la console Supabase : voir [DEPLOIEMENT](DEPLOIEMENT.md).
