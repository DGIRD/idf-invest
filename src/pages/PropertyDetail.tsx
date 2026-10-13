import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { Channel, Insert, PropertyStatus, PropertyTask, Scenario, TimelineEvent } from '../data/types.ts';
import { date, dateTime, money, number, pct, todayParis } from '../domain/format.ts';
import { CHANNEL_LABELS, EVENT_LABELS, OCCUPATION_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, STATUS_ORDER, TAX_REGIME_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { isOwned, metrics, scenarioResult } from '../domain/property.ts';
import { normalizeInputs, simulate } from '../domain/simulator.ts';
import { Button, EmptyState, KeyValue, NotAvailable, PageHeader, Section, StatusBadge, Tabs, TextInput, useConfirm } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';
import { usePropertyActions } from './useActions.tsx';

type Tab = 'synthese' | 'simulations' | 'historique' | 'taches' | 'documents' | 'gestion';

export function PropertyDetailPage({ id }: { id: string }) {
  const store = useStore();
  const { data, simulatorDefaults, update, remove, create, notify } = store;
  const { ask, dialog } = useConfirm();
  const actions = usePropertyActions(ask);
  const [tab, setTab] = useState<Tab>('synthese');
  const p = data.properties.find((x) => x.id === id);
  const m = useMemo(() => (p ? metrics(p, data.scenarios, simulatorDefaults) : null), [p, data.scenarios, simulatorDefaults]);
  if (!p || !m) {
    return <EmptyState title="Bien introuvable" action={<Button onClick={() => navigate('/prospection')}>Retour à la prospection</Button>}>Il a peut-être été supprimé sur un autre appareil.</EmptyState>;
  }
  const owned = isOwned(p);
  const agency = data.contacts.find((c) => c.id === p.agency_id);
  const agent = data.contacts.find((c) => c.id === p.agent_id);
  const scenarios = data.scenarios.filter((s) => s.property_id === p.id);
  const events = data.events.filter((e) => e.property_id === p.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const tasks = data.tasks.filter((t) => t.property_id === p.id);
  const openTasks = tasks.filter((t) => !t.done_at).length;
  const r = m.result;

  const tabs: [Tab, string][] = [
    ['synthese', 'Synthèse'],
    ['simulations', `Simulations (${scenarios.length})`],
    ['historique', `Historique et échanges (${events.length})`],
    ['taches', `Tâches (${openTasks})`],
    ['documents', 'Photos et documents'],
    ...(owned ? [['gestion', 'Baux, paiements, dépenses'] as [Tab, string]] : []),
  ];

  return (
    <>
      <p className="crumbs"><a href={href(owned ? '/biens' : '/prospection')}>{owned ? 'Mes biens' : 'Prospection'}</a></p>
      <PageHeader
        title={p.title}
        subtitle={<>{[TYPE_LABELS[p.property_type], p.surface ? `${number(p.surface)} m²` : null, p.rooms ? `${p.rooms} pièces` : null, [p.zip, p.city].filter(Boolean).join(' ') || null].filter(Boolean).join(', ')}</>}
        actions={<>
          <Button onClick={() => navigate(`/bien/${p.id}/modifier`)}>Modifier</Button>
          <Button onClick={() => navigate(m.scenario ? `/simulateur/${m.scenario.id}` : `/simulateur?bien=${p.id}`)}>Simuler</Button>
          {!owned && p.status !== 'archive' && <Button variant="primary" onClick={() => void actions.setStatus(p, 'acquis')}>Marquer comme acquis</Button>}
          <details className="menu menu-right">
            <summary className="btn btn-secondary">Plus</summary>
            <div className="menu-list">
              <button type="button" onClick={() => void actions.dup(p)}>Dupliquer</button>
              {!owned && <button type="button" onClick={() => void actions.toggleArchive(p)}>{p.status === 'archive' ? 'Désarchiver' : 'Archiver'}</button>}
              {owned && <button type="button" onClick={() => void actions.setStatus(p, 'sous_compromis')}>Revenir en prospection</button>}
              <button type="button" className="danger" onClick={async () => { if (await actions.del(p)) navigate(owned ? '/biens' : '/prospection'); }}>Supprimer</button>
            </div>
          </details>
        </>}
      />

      <div className="status-line">
        <StatusBadge status={p.status} />
        {owned && p.occupation_status && <span className="pill pill-neutral">{OCCUPATION_LABELS[p.occupation_status]}</span>}
        {!owned && (
          <label className="inline-select">Changer le statut
            <select value={p.status} onChange={(e) => void actions.setStatus(p, e.target.value as PropertyStatus)}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
        )}
        {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer">Voir l’annonce</a>}
      </div>

      <div className="figures">
        <Figure label="Prix affiché" value={money(p.asking_price)} />
        <Figure label="Prix proposé" value={money(p.offer_price)} />
        <Figure label="Prix / m²" value={money(m.pricePerM2)} />
        <Figure label="Rendement brut" value={pct(r?.grossYield)} />
        <Figure label="Cash-flow / mois" value={money(r?.cashflowMonthlyYear1)} tone={r ? (r.cashflowMonthlyYear1 >= 0 ? 'pos' : 'neg') : undefined} hint="avant fiscalité, année 1" />
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'synthese' && (
        <div className="two-col">
          <Section title="Caractéristiques">
            <KeyValue items={[
              ['Adresse', [p.address, p.zip, p.city].filter(Boolean).join(' ') || '—'],
              ['DPE renseigné', p.dpe ?? 'Non renseigné'],
              ['Budget travaux', money(p.works_budget)],
              ['Loyer estimé', p.estimated_rent ? `${money(p.estimated_rent)} / mois` : '—'],
              ['Agence', agency ? <a href={href(`/contacts/${agency.id}`)}>{agency.name}</a> : '—'],
              ['Agent', agent ? <a href={href(`/contacts/${agent.id}`)}>{agent.name}</a> : '—'],
              ...(owned ? [
                ['Mode de détention', p.ownership_mode ? OWNERSHIP_LABELS[p.ownership_mode] : 'Non renseigné'],
                ['Régime fiscal renseigné', p.tax_regime ? TAX_REGIME_LABELS[p.tax_regime] : 'Non renseigné'],
                ['Acquis le', date(p.acquired_at)],
                ['Coût d’acquisition', money(p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? null)],
              ] as [string, string][] : [
                ['Prochaine action', p.next_action ?? '—'],
                ['Relance', p.follow_up_date ? <span className={p.follow_up_date <= todayParis() ? 'neg' : ''}>{date(p.follow_up_date)}</span> : '—'],
                ['Visite', dateTime(p.visit_at)],
              ] as [string, React.ReactNode][]),
              ...(p.legacy_ref ? [['Origine', `Reprise IDF Invest (${p.legacy_ref})`] as [string, string]] : []),
            ]} />
          </Section>
          <div>
            {p.vigilance.length > 0 && (
              <Section title="Éléments de vigilance" className="vigilance">
                <ul>{p.vigilance.map((v, i) => <li key={i}>{v}</li>)}</ul>
              </Section>
            )}
            <Section title="Commentaires">
              {p.comments ? <p className="prewrap">{p.comments}</p> : <p className="muted">Aucun commentaire.</p>}
            </Section>
            {owned && p.acquisition_snapshot && (
              <Section title="Photographie à l’acquisition">
                <p className="muted small">Hypothèses figées le {dateTime(p.acquisition_snapshot.taken_at)} depuis « {p.acquisition_snapshot.scenario_name} ». Elles ne changent plus si le scénario est modifié.</p>
                <SnapshotFigures inputs={p.acquisition_snapshot.inputs} />
              </Section>
            )}
          </div>
        </div>
      )}

      {tab === 'simulations' && <ScenarioList propertyId={p.id} primaryId={p.primary_scenario_id} scenarios={scenarios}
        onPrimary={async (s) => { await update('properties', p, { primary_scenario_id: s.id }, `Le bien « ${p.title} »`); notify('Scénario principal défini.'); }}
        onDelete={async (s) => { if (await ask('Supprimer le scénario', `« ${s.name} » sera supprimé.`, 'Supprimer')) await remove('scenarios', s.id); }}
        onDuplicate={async (s) => { await create('scenarios', { property_id: p.id, name: `${s.name} (copie)`.slice(0, 120), inputs: s.inputs, results: s.results, engine_version: s.engine_version }); }}
      />}

      {tab === 'historique' && <Timeline propertyId={p.id} events={events} />}
      {tab === 'taches' && <Tasks propertyId={p.id} tasks={tasks} />}
      {tab === 'documents' && (
        <Section title="Photos et documents">
          <NotAvailable>Le stockage privé des photos et documents (classement, accès temporaire sécurisé, contrôle des types et tailles) est prévu au lot 2. Aucun fichier ne peut encore être déposé.</NotAvailable>
        </Section>
      )}
      {tab === 'gestion' && (
        <Section title="Gestion locative">
          <NotAvailable>Baux successifs, locataires, échéances, paiements, quittances, dépenses et interventions arrivent au lot 2. Ce bien est prêt à les recevoir.</NotAvailable>
        </Section>
      )}
      {dialog}
    </>
  );
}

function Figure({ label, value, tone, hint }: { label: string; value: string; tone?: 'pos' | 'neg'; hint?: string }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className={`figure-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="figure-hint">{hint}</span>}
    </div>
  );
}

function SnapshotFigures({ inputs }: { inputs: Scenario['inputs'] }) {
  const out = simulate(normalizeInputs(inputs));
  if (!out.ok) return <p className="muted">Hypothèses incomplètes.</p>;
  const r = out.result;
  return <KeyValue items={[
    ['Coût total', money(r.totalCost)], ['Emprunt', money(r.loanAmount)], ['Mensualité', money(r.monthlyPaymentWithInsurance)],
    ['Loyer mensuel', money(r.annualRent / 12)], ['Rendement brut', pct(r.grossYield)], ['Cash-flow / mois', money(r.cashflowMonthlyYear1)],
  ]} />;
}

function ScenarioList({ propertyId, primaryId, scenarios, onPrimary, onDelete, onDuplicate }: {
  propertyId: string; primaryId: string | null; scenarios: Scenario[];
  onPrimary: (s: Scenario) => void; onDelete: (s: Scenario) => void; onDuplicate: (s: Scenario) => void;
}) {
  return (
    <Section title="Simulations" actions={<Button variant="primary" size="sm" onClick={() => navigate(`/simulateur?bien=${propertyId}`)}>Nouvelle simulation</Button>}>
      {scenarios.length === 0 ? <EmptyState title="Aucune simulation">Lancez le simulateur pour estimer le coût, le crédit, le rendement et le cash-flow de ce bien.</EmptyState> : (
        <ul className="scenario-list">
          {scenarios.map((s) => {
            const r = scenarioResult(s);
            return (
              <li key={s.id}>
                <div>
                  <a href={href(`/simulateur/${s.id}`)} className="strong">{s.name}</a>
                  {s.id === primaryId && <span className="pill pill-ok">Principal</span>}
                  <p className="muted small">{r ? `Coût ${money(r.totalCost)}, mensualité ${money(r.monthlyPaymentWithInsurance)}, rendement ${pct(r.grossYield)}, cash-flow ${money(r.cashflowMonthlyYear1)}/mois` : 'Hypothèses invalides : ouvrez le scénario pour les corriger.'}</p>
                </div>
                <div className="row">
                  {s.id !== primaryId && <Button size="sm" onClick={() => onPrimary(s)}>Définir comme principal</Button>}
                  <Button size="sm" onClick={() => onDuplicate(s)}>Dupliquer</Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(s)}>Supprimer</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Timeline({ propertyId, events }: { propertyId: string; events: TimelineEvent[] }) {
  const { create, remove, data } = useStore();
  const [summary, setSummary] = useState('');
  const [channel, setChannel] = useState<Channel>('telephone');
  const [contactId, setContactId] = useState('');
  const [when, setWhen] = useState('');
  const contacts = data.contacts.filter((c) => !c.archived_at);
  async function add() {
    if (!summary.trim()) return;
    const row: Insert<TimelineEvent> = {
      property_id: propertyId, kind: 'exchange', channel, summary: summary.trim(), contact_id: contactId || null,
      occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
    };
    if (await create('timeline_events', row)) { setSummary(''); setWhen(''); }
  }
  return (
    <Section title="Historique et échanges">
      <div className="exchange-form">
        <label className="inline-select">Canal
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="inline-select">Avec
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="inline-select">Le
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <textarea aria-label="Compte rendu de l’échange" rows={2} placeholder="Compte rendu : ce qui a été dit, ce qui a été promis…" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <Button variant="primary" size="sm" disabled={!summary.trim()} onClick={() => void add()}>Ajouter l’échange</Button>
      </div>
      {events.length === 0 ? <p className="muted">Aucun événement.</p> : (
        <ol className="timeline">
          {events.map((e) => {
            const who = e.contact_id ? data.contacts.find((c) => c.id === e.contact_id) : null;
            const d = e.data as { from?: PropertyStatus; to?: PropertyStatus };
            return (
              <li key={e.id} className={`tl-${e.kind}`}>
                <time dateTime={e.occurred_at}>{dateTime(e.occurred_at)}</time>
                <div>
                  <span className="tl-kind">{EVENT_LABELS[e.kind]}{e.channel ? `, ${CHANNEL_LABELS[e.channel].toLowerCase()}` : ''}{who ? `, avec ${who.name}` : ''}</span>
                  <p className="prewrap">{e.summary}{d.from && d.to ? ` : ${STATUS_LABELS[d.from]} → ${STATUS_LABELS[d.to]}` : ''}</p>
                </div>
                {['exchange', 'note', 'visit'].includes(e.kind) && <button type="button" className="link danger" onClick={() => void remove('timeline_events', e.id)}>Supprimer</button>}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Tasks({ propertyId, tasks }: { propertyId: string; tasks: PropertyTask[] }) {
  const { create, update, remove } = useStore();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const today = todayParis();
  const sorted = [...tasks].sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  return (
    <Section title="Tâches">
      <div className="row task-form">
        <TextInput label="Nouvelle tâche" value={title} onChange={setTitle} maxLength={300} placeholder="Ex. Demander le diagnostic amiante" />
        <TextInput label="Échéance" type="date" value={due} onChange={setDue} />
        <Button variant="primary" size="sm" disabled={!title.trim()} onClick={async () => {
          if (await create('property_tasks', { property_id: propertyId, title: title.trim(), due_date: due || null })) { setTitle(''); setDue(''); }
        }}>Ajouter</Button>
      </div>
      {sorted.length === 0 ? <p className="muted">Aucune tâche.</p> : (
        <ul className="tasks">
          {sorted.map((t) => (
            <li key={t.id} className={t.done_at ? 'done' : ''}>
              <label className="checkbox">
                <input type="checkbox" checked={!!t.done_at} onChange={(e) => void update('property_tasks', t, { done_at: e.target.checked ? new Date().toISOString() : null }, 'La tâche')} />
                <span>{t.title}</span>
              </label>
              {t.due_date && <span className={!t.done_at && t.due_date < today ? 'neg small' : 'muted small'}>{date(t.due_date)}</span>}
              <button type="button" className="link danger" onClick={() => void remove('property_tasks', t.id)}>Supprimer</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
