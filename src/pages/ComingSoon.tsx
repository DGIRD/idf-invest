import { NotAvailable, PageHeader, Section } from '../ui/components.tsx';
import type { NavItem } from '../ui/Layout.tsx';

const CONTENT: Record<string, string[]> = {
  locataires: ['Fiches locataires et titulaires du bail, colocations', 'Baux successifs : dates, location vide ou meublée, loyer hors charges, provisions', 'Dépôt de garantie suivi à part des loyers', 'Changements de locataire et périodes sans occupation'],
  loyers: ['Échéances mensuelles générées depuis le bail', 'Paiements multiples, partiels, trop-perçus ; solde calculé uniquement depuis les mouvements', 'Confirmation mensuelle par e-mail au propriétaire (l’absence de réponse ne vaut jamais paiement)', 'Quittances PDF pour les seules périodes intégralement réglées, relances d’impayés avec aperçu'],
  depenses: ['Dépenses par bien : copropriété, taxe foncière, assurances, intérêts, travaux, mobilier, entretien, gestion', 'Justificatif, part récupérable, statut de paiement', 'Distinction trésorerie, charges, immobilisations et remboursement de capital'],
  documents: ['Stockage privé par bien, bail ou dépense', 'Classement, recherche, téléchargement par lien temporaire sécurisé', 'Contrôle des types et des tailles, politique de suppression'],
  synthese: ['Synthèse annuelle selon le régime renseigné, avec sources et hypothèses affichées', 'Données manquantes signalées, validation possible par un professionnel', 'Jamais présentée comme une attestation fiscale'],
  abonnement: ['Offres mensuelle et annuelle (Stripe), activation vérifiée côté serveur', 'Statut, période couverte, prochaine échéance ou fin d’accès, factures', 'Résiliation programmée distincte de l’expiration effective'],
};

export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} />
      <Section>
        <NotAvailable>Cette rubrique n’est pas encore disponible : elle est prévue au lot {item.plannedLot}. Aucune donnée n’y est enregistrée pour l’instant.</NotAvailable>
        <p>Ce qu’elle contiendra :</p>
        <ul>{(CONTENT[item.key] ?? []).map((c) => <li key={c}>{c}</li>)}</ul>
      </Section>
    </>
  );
}
