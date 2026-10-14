import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../data/store.tsx';
import { dateTime } from '../domain/format.ts';
import { Button, Modal } from './components.tsx';
import { href } from './router.ts';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  /** Lot de livraison si la rubrique n'est pas encore disponible. */
  plannedLot?: 2 | 3;
}

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Tableau de bord', path: '/' },
  { key: 'prospection', label: 'Prospection', path: '/prospection' },
  { key: 'simulateur', label: 'Simulateur', path: '/simulateur' },
  { key: 'biens', label: 'Mes biens', path: '/biens' },
  { key: 'locataires', label: 'Locataires et baux', path: '/locataires', plannedLot: 2 },
  { key: 'loyers', label: 'Loyers et paiements', path: '/loyers', plannedLot: 2 },
  { key: 'depenses', label: 'Dépenses', path: '/depenses', plannedLot: 2 },
  { key: 'contacts', label: 'Contacts', path: '/contacts' },
  { key: 'documents', label: 'Documents', path: '/documents', plannedLot: 2 },
  { key: 'synthese', label: 'Synthèse annuelle', path: '/synthese', plannedLot: 3 },
  { key: 'abonnement', label: 'Mon abonnement', path: '/abonnement', plannedLot: 3 },
  { key: 'parametres', label: 'Paramètres', path: '/parametres' },
];

function SyncIndicator() {
  const { sync, refresh, repo } = useStore();
  const label = {
    loading: 'Synchronisation…',
    saving: 'Enregistrement…',
    synced: repo.mode === 'demo' ? 'Enregistré dans ce navigateur' : 'Synchronisé',
    offline: 'Hors connexion',
    error: 'Erreur de synchronisation',
  }[sync.state];
  return (
    <button type="button" className={`sync sync-${sync.state}`} onClick={() => void refresh()}
      title={`${sync.message ?? label}${sync.lastSync ? ` — dernière synchronisation ${dateTime(sync.lastSync)}` : ''}. Cliquer pour resynchroniser.`}>
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-label">{label}</span>
    </button>
  );
}

export function Layout({ active, children }: { active: string; children: ReactNode }) {
  const { session, signOut, repo, toasts, dismissToast, conflict, sync } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [active]);

  return (
    <div className="shell">
      {repo.mode === 'demo' && (
        <div className="demo-banner" role="status">
          Mode démonstration : les données restent dans ce navigateur, sans sauvegarde en ligne. Aucun e-mail ni paiement n’est envoyé.
        </div>
      )}
      {sync.state === 'offline' && <div className="offline-banner" role="status">{sync.message ?? 'Hors connexion.'}</div>}

      <header className="topbar">
        <button type="button" className="icon-btn nav-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>
          <span aria-hidden="true">☰</span><span className="sr-only">Menu</span>
        </button>
        <a href={href('/')} className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 26h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>
          <span>Immo-Zen</span>
        </a>
        <div className="topbar-right">
          <SyncIndicator />
          <span className="user-email" title={session?.email}>{session?.email}</span>
          <Button size="sm" onClick={() => void signOut()}>Déconnexion</Button>
        </div>
      </header>

      <div className="body">
        <nav id="main-nav" className={`sidenav${open ? ' open' : ''}`} aria-label="Navigation principale">
          <ul>
            {NAV.map((n) => (
              <li key={n.key}>
                <a href={href(n.path)} className={active === n.key ? 'active' : ''} aria-current={active === n.key ? 'page' : undefined}>
                  <span>{n.label}</span>
                  {n.plannedLot && <span className="soon" title={`Prévu au lot ${n.plannedLot}`}>lot {n.plannedLot}</span>}
                </a>
              </li>
            ))}
          </ul>
          <p className="tagline">Prospectez, investissez et gérez vos locations sereinement.</p>
        </nav>
        <main className="content" id="contenu">{children}</main>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>

      <Modal open={!!conflict} title="Modification concurrente" onClose={() => conflict?.resolve('reload')}
        footer={<>
          <Button onClick={() => conflict?.resolve('reload')}>Recharger la version enregistrée</Button>
          <Button variant="danger" onClick={() => conflict?.resolve('overwrite')}>Remplacer par mes modifications</Button>
        </>}>
        <p>{conflict?.label} a été modifié depuis un autre appareil ou un autre onglet après son ouverture ici.</p>
        <p className="muted">Rien n’a été écrasé. Choisissez de recharger la version enregistrée (vos modifications sont abandonnées) ou de la remplacer par la vôtre.</p>
      </Modal>
    </div>
  );
}
