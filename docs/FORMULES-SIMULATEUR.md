# Formules du simulateur

Source : `src/domain/simulator.ts` (fonctions pures). Tests : `tests/simulator.test.ts`.
Résultats **avant fiscalité** : aucun impôt, amortissement comptable ni prélèvement social n'est calculé.

## Paramètres par défaut (modifiables dans Paramètres)

Frais de notaire 7,5 % · frais d'agence 10 000 € · crédit 3,5 % · 20 ans · assurance 0,3 % par an · assurance PNO 99 € par an.

## Négociation et prix au m²

- **Prix proposé FAI** = prix proposé (mode « honoraires inclus ») ou prix proposé + frais d'agence (mode « hors honoraires »).
- **Négociation** = prix de présentation FAI − prix proposé FAI ; en % du prix de présentation. Non calculée sans les deux prix ; avertissement si le prix proposé dépasse le prix de présentation.
- **Prix au m²** = prix proposé FAI / surface.

## Loyer

- **Loyer hors charges** = surface × loyer au m² « bas » ou « haut » selon le sélecteur, arrondi au centime ; ou montant saisi en « saisie libre ». Les scénarios enregistrés avant cette version restent en saisie libre (loyer inchangé).
- **Loyer charges comprises** = loyer hors charges + provision sur charges.
- **Charges de copropriété** : la part récupérable (par an) et la provision (par mois) sont proposées à 80 % du montant, en euros entiers arrondis au supérieur (ex. 1 000 € → 800 €/an et 67 €/mois). Une valeur modifiée à la main n'est plus recalculée.

## Acquisition

- **Prix hors honoraires** = prix proposé (mode « hors honoraires ») ou prix proposé − honoraires (mode « honoraires inclus »). Refus si les honoraires dépassent le prix.
- **Frais de notaire** = prix hors honoraires × taux, ou montant saisi. Convention : les honoraires d'agence à la charge de l'acquéreur n'entrent pas dans l'assiette.
- **Coût total** = prix hors honoraires + frais d'agence + notaire + travaux + mobilier + garantie + dossier.

## Financement

- **Emprunt** = max(0, coût total − apport). Sans crédit : emprunt nul, tout est apport. Apport supérieur au coût : emprunt nul et avertissement.
- **Mensualité** (hors assurance), t = taux annuel / 12, n = mois d'amortissement :
  `M = C × t / (1 − (1 + t)^−n)` ; si t = 0 : `M = C / n`.
- **Assurance** = capital initial × taux annuel / 12, constante pendant toute la durée, différé compris.
- **Différé partiel** (D mois) : intérêts seuls payés ; amortissement ensuite sur n − D mois.
- **Différé total** : rien n'est payé hors assurance ; les intérêts mensuels s'ajoutent au capital, amorti ensuite sur n − D mois.
- **Coût du financement** = intérêts (y compris capitalisés) + assurance + garantie + dossier.

### Arrondis

Calcul ligne à ligne au centime, arrondi commercial : intérêts du mois = arrondi(capital restant × t) ; mensualité arrondie ; capital = mensualité − intérêts ; **la dernière échéance solde exactement le capital** (écart de quelques centimes). Les rendements ne sont pas arrondis avant affichage.

## Exploitation (année pleine)

- **Loyers annuels** = loyer hors charges × 12.
- **Charges non récupérables** = (copropriété − part récupérable) + (taxe foncière − part récupérable) + PNO + gestion + GLI + entretien + autres.
- Convention : les **provisions** versées par le locataire sont supposées égales aux **charges récupérables** (neutres pour la trésorerie). Un avertissement apparaît si l'écart dépasse 10 % (et 50 €).
- **Revenu net avant crédit** = loyers − vacance − charges non récupérables.
- **Rendement brut** = loyers annuels / coût total.
- **Rendement après charges** = revenu net avant crédit / coût total.

## Cash-flow avant fiscalité

`cash-flow année 1 = revenu net avant crédit − (échéances + assurance des 12 premiers mois)`, affiché en moyenne mensuelle ; un second chiffre donne le cash-flow mensuel après le différé.

Le **remboursement du capital** est inclus dans le cash-flow (c'est une sortie de trésorerie) mais **n'est jamais compté comme une charge** : il n'entre ni dans les charges, ni dans les rendements ; il est affiché à part (« capital remboursé année 1 »).

## Validation

Valeurs négatives ou non numériques refusées ; durée entière de 1 à 40 ans ; taux ≤ 25 % ; assurance ≤ 5 % ; différé de 1 à 36 mois et plus court que le prêt ; parts récupérables ≤ montants totaux. Tant qu'une erreur subsiste, l'enregistrement est bloqué.

## Cas testés

Mensualité de référence (200 000 € · 3,5 % · 20 ans = 1 159,92 €), capital remboursé = capital emprunté, taux nul, absence de crédit, apport élevé, frais déjà inclus, notaire en montant, différés partiel et total, valeurs invalides, saisies « 215 000,50 », arrondis.
