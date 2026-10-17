import { useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { ACCESS_REASONS, STATUS_LABELS, type Plan } from '../data/platform.ts';
import { describeError } from '../data/repo.ts';
import { date, money2 } from '../domain/format.ts';
import { Button, KeyValue, NotAvailable, PageHeader, Pill, Section } from '../ui/components.tsx';
import { useRoute } from '../ui/router.ts';

export const planPrice = (p: Plan) => `${money2(p.amount_cents / 100)} / ${p.billing_interval === 'month' ? 'mois' : 'an'}`;

export function SubscriptionPage() {
  const { platform, refreshPlatform, repo, notify } = useStore();
  const route = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const back = route.query.get('retour');
  useEffect(() => { void refreshPlatform(); }, [refreshPlatform]);

  async function go(kind: 'checkout' | 'portal', plan?: Plan['code']) {
    setBusy(kind + (plan ?? ''));
    try {
      const url = kind === 'checkout' ? await repo.platform.checkout(plan!) : await repo.platform.portal();
      location.assign(url);
    } catch (e) {
      notify(describeError(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (platform === undefined) return <PageHeader title="Mon abonnement" subtitle="Chargement…" />;
  if (platform === null) {
    return (
      <>
        <PageHeader title="Mon abonnement" />
        <NotAvailable>La base de données n’est pas encore à jour pour les abonnements (migration du lot 3 à exécuter). Votre accès n’est pas limité.</NotAvailable>
      </>
    );
  }
  const { access, subscription: s, plans, config } = platform;
  const offered = plans.filter((p) => p.active && p.stripe_price_id && p.amount_cents > 0);
  const running = s?.source === 'stripe' && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status);

  return (
    <>
      <PageHeader title="Mon abonnement" subtitle="Statut, période couverte, factures et résiliation." />
      {back === 'ok' && <p className="note" role="status">Paiement transmis. L’abonnement s’active dès que Stripe le confirme (quelques secondes) ; rechargez la page si besoin.</p>}
      {back === 'annule' && <p className="note" role="status">Paiement annulé : aucun montant n’a été prélevé.</p>}
      <Section title="Accès">
        <KeyValue items={[
          ['État', <>{access.has_access ? <Pill tone="ok">Accès complet</Pill> : <Pill tone="bad">Consultation seule</Pill>} {ACCESS_REASONS[access.reason] ?? access.reason}</>],
          ...(access.until ? [[access.reason === 'essai' ? 'Fin de l’essai' : 'Accès jusqu’au', date(access.until)] as [string, string]] : []),
          ['Abonnement', s ? `${STATUS_LABELS[s.status]}${s.source === 'manuel' ? ' (accordé par Immo-Zen)' : ''}` : STATUS_LABELS.none],
          ...(s?.plan_code ? [['Offre', plans.find((p) => p.code === s.plan_code)?.label ?? s.plan_code] as [string, string]] : []),
          ...(s?.current_period_end ? [[s.cancel_at_period_end || s.status === 'canceled' ? 'Fin d’accès' : 'Prochaine échéance', date(s.current_period_end)] as [string, string]] : []),
        ]} />
        {s?.cancel_at_period_end && s.status !== 'canceled' && <p className="muted">Résiliation programmée : l’abonnement reste actif jusqu’au {date(s.current_period_end)}, puis s’arrête sans nouveau prélèvement.</p>}
        {s?.status === 'past_due' && <p className="form-error">Le dernier prélèvement a échoué. Stripe va le retenter ; mettez à jour votre moyen de paiement pour éviter l’interruption.</p>}
        {!access.has_access && <p>Vos données restent consultables et exportables. Abonnez-vous pour pouvoir à nouveau les modifier.</p>}
        {!access.enforce && access.reason !== 'administrateur' && <p className="muted small">Phase de lancement : l’application est utilisable sans abonnement pour l’instant.</p>}
      </Section>

      {running ? (
        <Section title="Gérer mon abonnement">
          <p>Factures, moyen de paiement, changement d’offre et résiliation se font dans l’espace client sécurisé de Stripe.</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void go('portal')}>{busy === 'portal' ? 'Ouverture…' : 'Ouvrir l’espace client'}</Button>
        </Section>
      ) : (
        <Section title="Offres">
          {offered.length === 0 ? (
            <NotAvailable>Les offres ne sont pas encore ouvertes : le paiement en ligne sera disponible prochainement.{config?.support_email ? <> Contact : <a href={`mailto:${config.support_email}`}>{config.support_email}</a>.</> : null}</NotAvailable>
          ) : (
            <div className="plans">
              {offered.map((p) => (
                <div key={p.code} className="plan">
                  <h3>{p.label}</h3>
                  <p className="plan-price">{planPrice(p)}</p>
                  <Button variant="primary" disabled={!!busy || repo.mode === 'demo'} onClick={() => void go('checkout', p.code)}>{busy === 'checkout' + p.code ? 'Redirection…' : 'S’abonner'}</Button>
                </div>
              ))}
            </div>
          )}
          <p className="muted small">Paiement sécurisé par Stripe : Immo-Zen ne voit jamais votre numéro de carte. L’abonnement n’est activé qu’après confirmation du paiement par Stripe.</p>
          {s?.stripe_customer_id && <Button size="sm" disabled={!!busy} onClick={() => void go('portal')}>Mes factures</Button>}
        </Section>
      )}
    </>
  );
}
