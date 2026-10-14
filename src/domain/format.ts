const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export const money = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : eur.format(x));
export const money2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : eur2.format(x));
export const number = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : num.format(x));
export const pct = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

/** Date ISO (AAAA-MM-JJ ou horodatage) → JJ/MM/AAAA, sans décalage de fuseau pour les dates seules. */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Date du jour à Paris au format AAAA-MM-JJ. */
export function todayParis(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
