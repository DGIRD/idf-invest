import { useMemo } from 'react';
import { useStore } from '../data/store.tsx';
import type { PropertyStatus } from '../data/types.ts';
import { date, dateTime, money, todayParis } from '../domain/format.ts';
import { STATUS_LABELS, statusTone } from '../domain/labels.ts';
import { isOwned, metrics } from '../domain/property.ts';
import { Button, EmptyState, PageHeader, Section } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';

const PIPELINE: PropertyStatus[] = ['repere', 'a_contacter', 'informations_demandees', 'visite_a_programmer', 'visite_programmee', 'visite', 'offre_envisagee', 'offre_transmise', 'negociation', 'offre_acceptee', 'sous_compromis'];

export function DashboardPage() {
  const { data, simulatorDefaults } = useStore();
  const today = todayParis();
  const in7 = todayParis(new Date(Date.now() + 7 * 86400000));

  const v = useMemo(() => {
    const prospects = data.properties.filter((p) => !isOwned(p) && PIPELINE.includes(p.status));
    const owned = data.properties.filter(isOwned);
    const counts = PIPELINE.map((s) => [s, prospects.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
    const followUps = data.properties.filter((p) => p.follow_up_date && p.follow_up_date <= today && p.status !== 'archive' && !isOwned(p))
      .sort((a, b) => a.follow_up_date!.localeCompare(b.follow_up_date!));
    const visits = data.properties.filter((p) => p.visit_at && p.visit_at.slice(0, 10) >= today && p.visit_at.slice(0, 10) <= in7)
      .sort((a, b) => a.visit_at!.localeCompare(b.visit_at!));
    const tasks = data.tasks.filter((t) => !t.done_at && t.due_date && t.due_date <= in7).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
    const contactFollow = data.contacts.filter((c) => !c.archived_at && c.next_follow_up && c.next_follow_up <= today);
    const ownedCash = owned.reduce((a, p) => a + (metrics(p, data.scenarios, simulatorDefaults).result?.cashflowMonthlyYear1 ?? 0), 0);
    const ownedRent = owned.reduce((a, p) => a + (p.estimated_rent ?? 0), 0);
    const offers = prospects.filter((p) => ['offre_transmise', 'negociation', 'offre_acceptee', 'sous_compromis'].includes(p.status)).length;
    return { prospects, owned, counts, followUps, visits, tasks, contactFollow, ownedCash, ownedRent, offers };
  }, [data, today, in7, simulatorDefaults]);

  const max = Math.max(1, ...v.counts.map(([, n]) => n));
  const empty = data.properties.length === 0;

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} />
      {empty ? (
        <EmptyState title="Commencez par un premier bien"
          action={<div className="row"><Button variant="primary" onClick={() => navigate('/bien/nouveau?mode=prospect')}>Ajouter un bien en prospection</Button><Button onClick={() => navigate('/simulateur')}>Faire une simulation</Button></div>}>
          Repérez une annonce, lancez une simulation, puis suivez vos échanges jusqu’à l’acquisition. Vous reprenez des données d’IDF Invest ? Voir Paramètres.
        </EmptyState>
      ) : (
        <>
          <div className="figures">
            <a className="figure link-figure" href={href('/prospection')}><span className="figure-label">En prospection</span><span className="figure-value">{v.prospects.length}</span><span className="figure-hint">dont {v.offers} offre{v.offers > 1 ? 's' : ''} en cours</span></a>
            <a className="figure link-figure" href={href('/prospection')}><span className="figure-label">Relances à faire</span><span className={`figure-value ${v.followUps.length ? 'neg' : ''}`}>{v.followUps.length + v.contactFollow.length}</span><span className="figure-hint">biens et contacts</span></a>
            <a className="figure link-figure" href={href('/biens')}><span className="figure-label">Biens détenus</span><span className="figure-value">{v.owned.length}</span><span className="figure-hint">loyers estimés {money(v.ownedRent)} / mois</span></a>
            <div className="figure"><span className="figure-label">Cash-flow prévisionnel</span><span className={`figure-value ${v.ownedCash >= 0 ? 'pos' : 'neg'}`}>{money(v.ownedCash)}</span><span className="figure-hint">par mois, biens détenus, d’après les simulations</span></div>
          </div>

          <div className="two-col">
            <Section title="À faire">
              {v.followUps.length + v.visits.length + v.tasks.length + v.contactFollow.length === 0 ? <p className="muted">Rien d’urgent cette semaine.</p> : (
                <ul className="agenda">
                  {v.followUps.map((p) => <li key={`f${p.id}`}><span className={p.follow_up_date! < today ? 'neg' : ''}>{date(p.follow_up_date)}</span><a href={href(`/bien/${p.id}`)}>Relancer : {p.title}</a>{p.next_action && <span className="muted">{p.next_action}</span>}</li>)}
                  {v.contactFollow.map((c) => <li key={`c${c.id}`}><span className={c.next_follow_up! < today ? 'neg' : ''}>{date(c.next_follow_up)}</span><a href={href(`/contacts/${c.id}`)}>Relancer : {c.name}</a></li>)}
                  {v.visits.map((p) => <li key={`v${p.id}`}><span>{dateTime(p.visit_at)}</span><a href={href(`/bien/${p.id}`)}>Visite : {p.title}</a></li>)}
                  {v.tasks.map((t) => {
                    const p = data.properties.find((x) => x.id === t.property_id);
                    return <li key={`t${t.id}`}><span className={t.due_date! < today ? 'neg' : ''}>{date(t.due_date)}</span><a href={href(`/bien/${t.property_id}`)}>{t.title}</a>{p && <span className="muted">{p.title}</span>}</li>;
                  })}
                </ul>
              )}
            </Section>
            <Section title="Parcours de prospection">
              {v.counts.length === 0 ? <p className="muted">Aucun bien en cours.</p> : (
                <ul className="pipeline">
                  {v.counts.map(([s, n]) => (
                    <li key={s}>
                      <span>{STATUS_LABELS[s]}</span>
                      <span className={`bar tone-${statusTone(s)}`} style={{ width: `${(n / max) * 100}%` }} aria-hidden="true" />
                      <strong>{n}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
